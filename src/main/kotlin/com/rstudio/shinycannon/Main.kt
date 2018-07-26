package com.rstudio.shinycannon

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.neovisionaries.ws.client.WebSocket
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.DefaultHelpFormatter
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import mu.KLogger
import mu.KotlinLogging
import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.impl.client.BasicCookieStore
import org.apache.log4j.FileAppender
import org.apache.log4j.Level
import org.apache.log4j.Logger
import org.apache.log4j.PatternLayout
import java.io.File
import java.io.PrintWriter
import java.lang.Exception
import java.math.BigDecimal
import java.nio.file.Paths
import java.security.SecureRandom
import java.time.Instant
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.regex.Pattern
import kotlin.collections.ArrayList
import kotlin.concurrent.thread

fun readRecording(recording: File): ArrayList<Event> {
    return recording.readLines()
            .asSequence()
            .mapIndexed { idx, line -> Pair(idx + 1, line) }
            .filterNot { it.second.startsWith("#") }
            .fold(ArrayList()) { events, (lineNumber, line) ->
                events.also { it.add(Event.fromLine(lineNumber, line)) }
            }
}

fun eventlogDuration(events: ArrayList<Event>) = events.last().begin - events.first().begin

fun randomHexString(numchars: Int): String {
    val r = SecureRandom()
    val sb = StringBuffer()
    while (sb.length < numchars) sb.append(java.lang.Integer.toHexString(r.nextInt()))
    return sb.toString().substring(0, numchars)
}

fun getTokens(url: String): HashSet<String> {
    val tokens = HashSet<String>()
    for (token in Regex("""\$\{([A-Z_]+)}""").findAll(url)) {
        // we know the next line is safe because: token.groups.forEach { println(it) }
        tokens.add(token.groups[1]!!.value)
    }
    return tokens
}

fun replaceTokens(s: String,
                  allowedTokens: HashSet<String>,
                  tokenDictionary: HashMap<String, String>): String {

    val tokensInUrl = getTokens(s)

    if (allowedTokens.union(tokensInUrl) != allowedTokens) {
        val illegalTokens = tokensInUrl.filterNot { allowedTokens.contains(it) }
        throw Exception("$illegalTokens are illegal tokens")
    }

    return tokensInUrl.fold(s) { newS, tokenName ->
        if (!tokenDictionary.containsKey(tokenName))
            throw Exception("$tokenName is an allowed token, but it isn't present in the dictionary")
        newS.replace("\${$tokenName}", tokenDictionary[tokenName]!!, true)
    }
}

fun parseMessage(msg: String): JsonObject? {
    // If an unparsed message is from a reconnect-enabled server, it will have a
    // message ID on it. We want to ignore those for the purposes of looking at
    // matches, because they can vary sometimes (based on ignorable messages
    // sneaking into the message stream).
    val normalized = msg.replace("""^a\["[0-9A-F]+""".toRegex(), """a["*""")

    val re = Pattern.compile("""^a\["(\*#)?0\|m\|(.*)"\]${'$'}""")
    val matcher = re.matcher(normalized)
    val json = JsonParser()
    if (matcher.find()) {
        val inner = json.parse("\"${matcher.group(2)}\"").asString
        return json.parse(inner).asJsonObject
    } else  if (msg == "o") {
        return null
    } else {
        // Note: if no match found, we're probably running against dev server or SSO
        return json.parse(msg).asJsonObject
    }
}

// Represents a single "user" during the course of a LoadTest.
class ShinySession(val sessionId: Int,
                   val workerId: Int,
                   val iterationId: Int,
                   val httpUrl: String,
                   val recording: File,
                   var script: ArrayList<Event>,
                   val log: KLogger,
                   val credentials: Pair<String, String>?) {

    val wsUrl: String = URIBuilderTiny(httpUrl).let { uri ->
        uri.setScheme(when (uri.scheme) {
            "http" -> "ws"
            "https" -> "wss"
            else -> error("Unknown scheme: ${uri.scheme}")
        }).build().toString()
    }

    val allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID", "SESSION", "UPLOAD_URL", "UPLOAD_JOB_ID")
    val tokenDictionary: HashMap<String, String> = hashMapOf(
            Pair("ROBUST_ID", randomHexString(18)),
            Pair("SOCKJSID", "000/${randomHexString(8)}")
    )

    var webSocket: WebSocket? = null
    val receiveQueueSize = 5
    val receiveQueue: LinkedBlockingQueue<String> = LinkedBlockingQueue(receiveQueueSize)

    var lastEventEnded: Long? = null

    val cookieStore = BasicCookieStore()

    fun replaceTokens(s: String) = replaceTokens(s, allowedTokens, tokenDictionary)

    private fun maybeLogin() {
        credentials?.let { (username, password) ->
            if (isProtected(httpUrl)) {
                cookieStore.addCookie(postLogin(httpUrl, username, password))
            } else {
                info("SHINYCANNON_USER and SHINYCANNON_PASS set, but target app doesn't require authentication.")
            }
        }
    }

    fun run(startDelayMs: Int = 0, out: PrintWriter, stats: Stats) {
        maybeLogin()
        if (startDelayMs > 0) {
            out.printCsv(sessionId, "PLAYBACK_START_INTERVAL_START", nowMs(), 0, "")
            Thread.sleep(startDelayMs.toLong())
            out.printCsv(sessionId, "PLAYBACK_START_INTERVAL_END", nowMs(), 0, "")
        }
        stats.transition(Stats.Transition.RUNNING)
        for (i in 0 until script.size) {
            val currentEvent = script[i]
            val sleepFor = currentEvent.sleepBefore(this)
            if (sleepFor > 0) {
                out.printCsv(sessionId, workerId, iterationId, "PLAYBACK_SLEEPBEFORE_START", nowMs(), currentEvent.lineNumber, "")
                Thread.sleep(sleepFor)
                out.printCsv(sessionId, workerId, iterationId, "PLAYBACK_SLEEPBEFORE_END", nowMs(), currentEvent.lineNumber, "")
            }
            if (!currentEvent.handle(this, out)) {
                stats.transition(Stats.Transition.FAILED)
                out.printCsv(sessionId, workerId, iterationId, "PLAYBACK_FAIL", nowMs(), currentEvent.lineNumber, "")
                return
            }
            lastEventEnded = currentEvent.begin
        }
        stats.transition(Stats.Transition.DONE)
        out.printCsv(sessionId, workerId, iterationId, "PLAYBACK_DONE", nowMs(), 0, "")
    }
}

fun nowMs() = Instant.now().toEpochMilli()

fun PrintWriter.printCsv(vararg columns: Any) {
    this.println(columns.joinToString(","))
    this.flush()
}

class Stats() {
    enum class State { RUN, DONE, FAIL }
    enum class Transition { RUNNING, FAILED, DONE }

    val stats = ConcurrentHashMap(mapOf(
            State.RUN to 0,
            State.DONE to 0,
            State.FAIL to 0
    ))

    fun transition(t: Transition) {
        stats.replaceAll { k, v ->
            when (Pair(t, k)) {
                Pair(Transition.RUNNING, State.RUN) -> v + 1
                Pair(Transition.DONE, State.RUN) -> v - 1
                Pair(Transition.DONE, State.DONE) -> v + 1
                Pair(Transition.FAILED, State.RUN) -> v - 1
                Pair(Transition.FAILED, State.FAIL) -> v + 1
                else -> v
            }
        }
    }

    override fun toString(): String {
        val copy = stats.toMap()
        return "Running: ${copy[State.RUN]}, Failed: ${copy[State.FAIL]}, Done: ${copy[State.DONE]}"
    }
}

fun getCreds() = listOf("SHINYCANNON_USER", "SHINYCANNON_PASS")
        .mapNotNull { System.getenv(it) }
        .takeIf { it.size == 2 }
        ?.zipWithNext()
        ?.first()

@Synchronized
fun info(msg: String) {
    println("${Instant.now().toString()} - $msg")
}

class EnduranceTest(val args: Sequence<String>,
                    val httpUrl: String,
                    val recording: File,
                    // Amount of time to wait between starting workers until target reached
                    val warmupInterval: Long = 0,
                    // Time to maintain target number of workers
                    val loadedDurationMinutes: BigDecimal,
                    // Number of workers to maintain
                    val numWorkers: Int,
                    val outputDir: File) {

    val columnNames = arrayOf("session_id", "worker_id", "iteration", "event", "timestamp", "input_line_number", "comment")

    // Todo: stats should make more sense to endurance test
    val stats = Stats()

    fun run() {
        val logger = KotlinLogging.logger {}
        val log = readRecording(recording)
        check(log.size > 0) { "input log must not be empty" }
        check(log.last().name() == "WS_CLOSE") { "last event in log not a WS_CLOSE (did you close the tab after recording?)"}

        val keepWorking = AtomicBoolean(true)
        val keepShowingStats = AtomicBoolean(true)
        val sessionNum = AtomicInteger(0)

        fun makeOutputFile(sessionId: Int, workerId: Int, iterationId: Int) = outputDir
                .toPath()
                .resolve(Paths.get("sessions", "${sessionId}_${workerId}_${iterationId}.csv"))
                .toFile()

        fun startSession(sessionId: Int, workerId: Int, iterationId: Int, delay: Int = 0) {
            val session = ShinySession(sessionId, workerId, iterationId, httpUrl, recording, log, logger, getCreds())
            val outputFile = makeOutputFile(sessionId, workerId, iterationId)
            outputFile.printWriter().use { out ->
                out.println("# " + args.joinToString(" "))
                out.printCsv(*columnNames)
                out.printCsv(sessionId, workerId, iterationId, "PLAYER_SESSION_CREATE", nowMs(), 0, "")
                session.run(delay, out, stats)
            }
        }

        // Continuous status output
        thread {
            while (keepShowingStats.get()) {
                info(stats.toString())
                Thread.sleep(5000)
            }
        }

        val warmupCountdown = CountDownLatch(numWorkers)
        val finishedCountdown = CountDownLatch(numWorkers)

        for (worker in 0 until numWorkers) {
            thread {
                var iteration = 0
                // Continue after some (possibly-zero) millisecond delay
                Thread.sleep(worker*warmupInterval)
                info("Worker $worker warming up")
                warmupCountdown.countDown()
                startSession(sessionNum.getAndIncrement(), worker, iteration++)
                while (keepWorking.get()) {
                    // Subsequent workers start immediately
                    info("Worker $worker running again")
                    startSession(sessionNum.getAndIncrement(), worker, iteration++)
                }
                info("Worker $worker stopped")
                finishedCountdown.countDown()
            }
        }

        info("Waiting for warmup to complete")
        warmupCountdown.await()
        // TODO minutes should be able to be fractional
        info("Maintaining for $loadedDurationMinutes minutes (${loadedDurationMinutes*BigDecimal(60000)} ms)")
        Thread.sleep((loadedDurationMinutes*BigDecimal(60000)).toLong())
        info("Stopped maintaining, waiting for workers to stop")
        keepWorking.set(false)
        finishedCountdown.await()
        keepShowingStats.set(false)
        // TODO make the stats thing update in place, and look cool too maybe?
    }

}

class Args(parser: ArgParser) {
    val recordingPath by parser.positional("Path to recording file")
    val appUrl by parser.positional("URL of the Shiny application to interact with")
    val workers by parser.storing("Number of workers to simulate. Default is 1.") { toInt() }
            .default(1)
    val loadedDurationMinutes by parser.storing("Number of minutes to continue simulating sessions in each worker after all workers have completed one session. Can be fractional. Default is 0.") { toBigDecimal() }
            .default(BigDecimal.ZERO)
    val outputDir by parser.storing("Path to directory to store session logs in for this test run")
            .default("test-logs-${Instant.now()}")
    val overwriteOutput by parser.flagging("Whether or not to delete the output directory before starting, if it exists already")
    val startInterval by parser.storing("Number of milliseconds to wait between starting workers. Defaults to the length of the recording divided by the number of workers.") {
        toLong()
    }.default(null)
    val logLevel by parser.storing("Log level (default: warn, available include: debug, info, warn, error)") {
        Level.toLevel(this.toUpperCase(), Level.WARN) as Level
    }.default(Level.INFO)
}

fun recordingDuration(recording: File): Long {
    val events = readRecording(recording)
    return events.last().begin - events.first().begin
}

fun main(args: Array<String>) = mainBody("shinycannon") {
    Args(ArgParser(args, helpFormatter = DefaultHelpFormatter(
            prologue = "shinycannon is a load generation tool for use with Shiny Server Pro and RStudio Connect.",
            epilogue = """
                environment variables:
                  SHINYCANNON_USER
                  SHINYCANNON_PASS
                """.trimIndent()
    ))).run {

        val recording = File(recordingPath)
        check(recording.isFile && recording.exists())
        val events = readRecording(recording)

        // If a startInterval was supplied, then use it. Otherwise, compute
        // based on the length of the recording and the number of workers.
        val computedStartInterval = startInterval ?: recordingDuration(recording) / workers

        val output = File(outputDir)

        if (output.exists()) {
            if (overwriteOutput) {
                // Ensure the existing directory we're about to delete is conceivably an output directory.
                check(listOf("recording.log", "detail.log", "sessions").map {
                    output.toPath().resolve(it).toFile()
                }.all { it.exists() }, {
                    "Directory doesn't look like an output directory, so not overwriting. Please delete it manually."
                })
                output.deleteRecursively()
            } else {
                error("Output dir $outputDir already exists and --overwrite-output not set")
            }
        }

        output.mkdirs()
        output.toPath().resolve("sessions").toFile().mkdir()

        // TODO Default to warn, and don't make a special detail.log: print thees messages to the console.
        val fa = FileAppender()
        fa.layout = PatternLayout("%5p [%t] %d (%F:%L) - %m%n")
        fa.threshold = logLevel
        fa.file = output.toPath().resolve("detail.log").toString()
        fa.activateOptions()
        Logger.getRootLogger().addAppender(fa)

        println("Logging at $logLevel level to $outputDir/detail.log")

        // Set global JVM exception handler before creating any new threads
        // https://stuartsierra.com/2015/05/27/clojure-uncaught-exceptions
        KotlinLogging.logger("Default").also {
            Thread.setDefaultUncaughtExceptionHandler { thread, exception ->
                it.error(exception, { "Uncaught exception on ${thread.name}" })
            }
        }

        // Copy the recording file to the output directory so runs are easily reproducible.
        recording.copyTo(output.toPath().resolve("recording.log").toFile())

        val loadTest = EnduranceTest(
                // Drop the original logpath from the arglist
                args.asSequence().drop(1),
                appUrl,
                recording,
                numWorkers = workers,
                outputDir = output,
                warmupInterval = computedStartInterval,
                loadedDurationMinutes = loadedDurationMinutes
        )
        loadTest.run()
    }
}
