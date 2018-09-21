package com.rstudio.shinycannon

import com.google.gson.*
import com.neovisionaries.ws.client.WebSocket
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.DefaultHelpFormatter
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.impl.client.BasicCookieStore
import org.apache.log4j.*
import java.io.File
import java.io.PrintWriter
import java.lang.Exception
import java.lang.reflect.Type
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
import kotlin.reflect.full.declaredMemberProperties
import kotlin.system.exitProcess

fun readRecording(recording: File): ArrayList<Event> {
    return recording.readLines()
            .asSequence()
            .mapIndexed { idx, line -> Pair(idx + 1, line) }
            .filterNot { it.second.startsWith("#") }
            .fold(ArrayList()) { events, (lineNumber, line) ->
                events.also { it.add(Event.fromLine(lineNumber, line)) }
            }
}

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

sealed class WSMessage() {
    data class String(val str: kotlin.String): WSMessage()
    data class Error(val err: Throwable): WSMessage()
}

// Represents a single "user" during the course of a LoadTest.
class ShinySession(val sessionId: Int,
                   val workerId: Int,
                   val iterationId: Int,
                   val httpUrl: String,
                   val recording: File,
                   var script: ArrayList<Event>,
                   val logger: Logger,
                   val credentials: Pair<String, String>?) {

    // This is something like an interrupt. It's checked in every iteration of the run-loop.
    // If it's non-null, the run-loop will terminate.
    var failure: Throwable? = null

    fun fail(cause: String) = fail(Throwable(cause))
    fun fail(cause: Throwable) {
        // This will cause the session to fail in the run-loop.
        failure = cause
        // This will cause the session to fail if it's currently waiting to receive a message.
        receiveQueue.offer(WSMessage.Error(cause))
    }

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
    val receiveQueue: LinkedBlockingQueue<WSMessage> = LinkedBlockingQueue(receiveQueueSize)

    var lastEventEnded: Long? = null

    val cookieStore = BasicCookieStore()

    fun replaceTokens(s: String) = replaceTokens(s, allowedTokens, tokenDictionary)

    private fun maybeLogin() {
        credentials?.let { (username, password) ->
            if (isProtected(httpUrl)) {
                postLogin(httpUrl, username, password, cookies = cookieStore)
            } else {
                 logger.info("SHINYCANNON_USER and SHINYCANNON_PASS set, but target app doesn't require authentication.")
            }
        }
    }

    private fun logFail(cause: Throwable, out: PrintWriter, stats: Stats, lineNumber: Int = 0) {
        stats.transition(Stats.Transition.FAILED)
        out.printCsv(sessionId, workerId, iterationId, "PLAYBACK_FAIL", nowMs(), lineNumber, "")
        logger.error("Playback failed: ${cause.message}", cause)
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
            try {
                // Since we might have been sleeping for awhile and the websocket might have failed in the meantime,
                // do a quick error check before attempting to handle the event.
                failure?.let {
                    logFail(it, out, stats, currentEvent.lineNumber)
                    return
                }
                currentEvent.handle(this, out)
            } catch (t: Throwable) {
                logFail(t, out, stats, currentEvent.lineNumber)
                return
            }
            lastEventEnded = currentEvent.begin
            failure?.let {
                logFail(it, out, stats, currentEvent.lineNumber)
                return
            }
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

class EnduranceTest(val argsStr: String,
                    val argsJson: String,
                    val httpUrl: String,
                    val recording: File,
                    // Amount of time to wait between starting workers until target reached
                    val warmupInterval: Long = 0,
                    // Time to maintain target number of workers
                    val loadedDurationMinutes: BigDecimal,
                    // Number of workers to maintain
                    val numWorkers: Int,
                    val outputDir: File,
                    val logger: Logger) {

    val columnNames = arrayOf("session_id", "worker_id", "iteration", "event", "timestamp", "input_line_number", "comment")

    // Todo: stats should make more sense to endurance test
    val stats = Stats()

    fun run() {
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
                out.println("# " + argsStr)
                out.println("# " + argsJson)
                out.printCsv(*columnNames)
                out.printCsv(sessionId, workerId, iterationId, "PLAYER_SESSION_CREATE", nowMs(), 0, "")
                session.run(delay, out, stats)
            }
        }

        // Continuous status output
        thread(name = "progress") {
            while (keepShowingStats.get()) {
                logger.info(stats.toString())
                Thread.sleep(5000)
            }
        }

        val warmupCountdown = CountDownLatch(numWorkers)
        val finishedCountdown = CountDownLatch(numWorkers)

        for (worker in 0 until numWorkers) {
            // Worker thread numbering is 1-based because the main thread is thread 0.
            thread(name = String.format("thread%02d", worker+1)) {
                var iteration = 0
                // Continue after some (possibly-zero) millisecond delay
                Thread.sleep(worker*warmupInterval.toLong())
                logger.info("Warming up")
                warmupCountdown.countDown()
                startSession(sessionNum.getAndIncrement(), worker, iteration++)
                while (keepWorking.get()) {
                    // Subsequent workers start immediately
                    logger.info("Running again")
                    startSession(sessionNum.getAndIncrement(), worker, iteration++)
                }
                logger.info("Stopped")
                finishedCountdown.countDown()
            }
        }

        logger.info("Waiting for warmup to complete")
        warmupCountdown.await()
        // TODO minutes should be able to be fractional
        logger.info("Maintaining for $loadedDurationMinutes minutes (${loadedDurationMinutes*BigDecimal(60000)} ms)")
        Thread.sleep((loadedDurationMinutes*BigDecimal(60000)).toLong())
        logger.info("Stopped maintaining, waiting for workers to stop")
        keepWorking.set(false)
        finishedCountdown.await()
        keepShowingStats.set(false)
        // TODO make the stats thing update in place, and look cool too maybe?
        
        logger.info("Complete. Failed: ${stats.stats[Stats.State.FAIL]}, Done: ${stats.stats[Stats.State.DONE]}")

        // Workaround until https://github.com/TakahikoKawasaki/nv-websocket-client/pull/169 is merged or otherwise fixed.
        // Timers in the websocket code hold up the JVM, so we must explicity terminate.
        exitProcess(0);
    }

}

class Args(parser: ArgParser) {
    val recordingPath by parser.positional("Path to recording file")
    val appUrl by parser.positional("URL of the Shiny application to interact with")
    val workers by parser.storing("Number of workers to simulate. Default is 1.") { toInt() }
            .default(1)
    val loadedDurationMinutes by parser.storing("Number of minutes to continue simulating sessions in each worker after all workers have completed one session. Can be fractional. Default is 0.") { toBigDecimal() }
            .default(BigDecimal.ZERO)
    val outputDir by parser.storing("Path to directory to store session logs in for this test run.")
            .default(Instant.now().let {
                // : is illegal in Windows filenames
                val inst = it.toString().replace(":", "_")
                "test-logs-${inst}"
            })
    val overwriteOutput by parser.flagging("Delete the output directory before starting, if it exists already.")
    val debugLog by parser.flagging("Produce a debug.log in the output directory. File can get very large. Defaults to false.")
    val startInterval by parser.storing("Number of milliseconds to wait between starting workers. Defaults to the length of the recording divided by the number of workers.") {
        toLong()
    }.default(null)
    val logLevel by parser.storing("Log level (default: warn, available include: debug, info, warn, error)") {
        Level.toLevel(this.toUpperCase(), Level.WARN) as Level
    }.default(Level.WARN)
}

class ArgsSerializer(): JsonSerializer<Args> {
    override fun serialize(args: Args, type: Type, ctx: JsonSerializationContext): JsonElement {
        val jsonObject = JsonObject()
        args.javaClass.kotlin.declaredMemberProperties.forEach {
            when (it.returnType.toString()) {
                "kotlin.String",
                "org.apache.log4j.Level!" -> jsonObject.addProperty(it.name, it.get(args).toString())
                "kotlin.Boolean" -> jsonObject.addProperty(it.name, it.get(args) as Boolean)
                "kotlin.Long?" -> jsonObject.addProperty(it.name, it.get(args) as kotlin.Long?)
                "kotlin.Int?" -> jsonObject.addProperty(it.name, it.get(args) as kotlin.Int?)
                "kotlin.Long" -> jsonObject.addProperty(it.name, it.get(args) as kotlin.Long)
                "kotlin.Int" -> jsonObject.addProperty(it.name, it.get(args) as kotlin.Int)
                "java.math.BigDecimal!" -> jsonObject.addProperty(it.name, (it.get(args) as BigDecimal).toFloat())
                else -> error("Don't know how to JSON-serialize argument type: ${it.returnType}")
            }
        }
        return jsonObject;
    }
}

val logPattern = "%d{yyyy-MM-dd HH:mm:ss.SSS} %p [%t] - %m%n"

class TersePatternLayout(pattern: String = logPattern): PatternLayout(pattern) {
    // Keeps the log message to one line by suppressing stacktrace
    override fun ignoresThrowable() = false
}

fun recordingDuration(recording: File): Long {
    val events = readRecording(recording)
    return events.last().begin - events.first().begin
}

// shinycannon-version.txt is added to the .jar by the Makefile. If the code is built by other means (like IntelliJ),
// that file won't be on the classpath.
fun getVersion() = Thread.currentThread()
        .contextClassLoader
        .getResource("shinycannon-version.txt")?.readText() ?: "development"

fun getUserAgent() = "shinycannon/${getVersion()}"

fun main(args: Array<String>) = mainBody("shinycannon") {

    Args(ArgParser(args, helpFormatter = DefaultHelpFormatter(
            prologue = "shinycannon is a load generation tool for use with Shiny Server Pro and RStudio Connect.",
            epilogue = """
                environment variables:
                  SHINYCANNON_USER
                  SHINYCANNON_PASS

                version: ${getVersion()}
                """.trimIndent()
    ))).run {

        Thread.currentThread().name = "thread00"

        val recording = File(recordingPath)

        if (!(recording.exists() && recording.isFile)) {
            error("recording '${recording}' doesn't exist or is not a file")
        }

        // If a startInterval was supplied, then use it. Otherwise, compute
        // based on the length of the recording and the number of workers.
        val computedStartInterval = startInterval ?: recordingDuration(recording) / workers

        val output = File(outputDir)

        if (output.exists()) {
            if (overwriteOutput) {
                // Ensure the existing directory we're about to delete is conceivably an output directory.
                check(listOf("recording.log", "sessions").map {
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
        output.toPath().resolve("shinycannon-version.txt").toFile().writeText(getVersion())

        // This appender prints DEBUG and above to debug.log and is added to the
        // global logger.
        var debugAppender: Appender? = null
        if (debugLog) {
            debugAppender = FileAppender()
            debugAppender.layout = PatternLayout(logPattern)
            debugAppender.threshold = Level.DEBUG
            debugAppender.file = output.toPath().resolve("debug.log").toString()
            debugAppender.activateOptions()
            Logger.getRootLogger().addAppender(debugAppender)
        }

        // This appender prints WARN and ERROR (by default) to the console and
        // is added to the global logger.
        val libraryAppender = ConsoleAppender()
        libraryAppender.layout = TersePatternLayout()
        libraryAppender.threshold = logLevel
        libraryAppender.activateOptions()
        Logger.getRootLogger().addAppender(libraryAppender)

        // This logger prints every application-level INFO or higher to the
        // console. All messages are also written to debug.log via debugAppender.
        val appAppender = ConsoleAppender()
        appAppender.layout = TersePatternLayout()
        appAppender.threshold = Level.INFO
        appAppender.activateOptions()
        val appLogger = Logger.getLogger("shinycannon").apply {
            addAppender(appAppender)
            debugAppender?.let { addAppender(it) }
            additivity = false
        }

        // Set global JVM exception handler before creating any new threads
        // https://stuartsierra.com/2015/05/27/clojure-uncaught-exceptions
        Thread.setDefaultUncaughtExceptionHandler { thread, exception ->
            appLogger.error("Uncaught exception on ${thread.name}", exception)
        }

        // Copy the recording file to the output directory so runs are easily reproducible.
        recording.copyTo(output.toPath().resolve("recording.log").toFile())

        val loadTest = EnduranceTest(
                // Drop the original logpath from the arglist
                args.asSequence().drop(1).joinToString(" "),
                GsonBuilder()
                        .registerTypeAdapter(Args::class.java, ArgsSerializer())
                        .create()
                        .toJson(this),
                appUrl,
                recording,
                numWorkers = workers,
                outputDir = output,
                warmupInterval = computedStartInterval,
                loadedDurationMinutes = loadedDurationMinutes,
                logger = appLogger)
        loadTest.run()
    }
}
