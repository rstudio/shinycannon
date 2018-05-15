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
import java.nio.file.Paths
import java.security.SecureRandom
import java.time.Instant
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.regex.Pattern
import kotlin.collections.ArrayList
import kotlin.concurrent.thread

fun readEventLog(logPath: String): ArrayList<Event> {
    return File(logPath).readLines()
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

// Messages strings originating from the server are not escaped. Strings
// originating from the log file are escaped.
fun unescape(s: String) = """\\(.)""".toRegex().replace(s, """$1""")

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
    } else {
        return null
    }
}

// Represents a single "user" during the course of a LoadTest.
class ShinySession(val sessionId: Int,
                   val outputDir: File,
                   val httpUrl: String,
                   var script: ArrayList<Event>,
                   val log: KLogger,
                   val credentials: Pair<String, String>?) {

    val wsUrl: String = URIBuilderTiny(httpUrl).setScheme("ws").build().toString()

    val allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID", "SESSION")
    val tokenDictionary: HashMap<String, String> = hashMapOf(
            Pair("ROBUST_ID", randomHexString(18)),
            Pair("SOCKJSID", "000/${randomHexString(8)}")
    )

    var webSocket: WebSocket? = null
    val receiveQueueSize = 5
    val receiveQueue: LinkedBlockingQueue<String> = LinkedBlockingQueue(receiveQueueSize)

    var lastEventCreated: Long? = null

    val cookieStore = BasicCookieStore()

    fun replaceTokens(s: String) = replaceTokens(s, allowedTokens, tokenDictionary)

    fun end() {
        log.debug { "Ending session" }
        // TODO either assert that there are no pending inbound messages, OR warn about them?
        Thread.sleep(1000)
        // By this time, the WS_CLOSE event should already have been processed and the websocket should be closed (null is also accepted)

        if (webSocket?.isOpen ?: false) {
            log.warn { "Websocket should already be closed" }
            webSocket?.sendClose()
        }
    }

    private fun maybeLogin() {
        credentials?.let { (username, password) ->
            if (isProtected(httpUrl)) {
                ProtectedApp(httpUrl).let { app ->
                    cookieStore.addCookie(app.postLogin(username, password))
                }
            } else {
                log.info {
                    "SHINYCANNON_USER and SHINYCANNON_PASS are set, but the target app is not protected."
                }
            }
        }
    }

    fun run(startDelayMs: Int = 0, out: PrintWriter, stats: Stats) {
        maybeLogin()
        lastEventCreated = nowMs()
        if (startDelayMs > 0) {
            out.printCsv(sessionId, "PLAYBACK_START_INTERVAL_START", nowMs())
            Thread.sleep(startDelayMs.toLong())
            out.printCsv(sessionId, "PLAYBACK_START_INTERVAL_END", nowMs())
        }
        stats.transition(Stats.Transition.RUNNING)
        for (i in 0 until script.size) {
            val currentEvent = script[i]
            val sleepFor = currentEvent.sleepBefore(this)
            if (sleepFor > 0) {
                out.printCsv(sessionId, "PLAYBACK_SLEEPBEFORE_START", nowMs(), currentEvent.lineNumber)
                Thread.sleep(sleepFor)
                out.printCsv(sessionId, "PLAYBACK_SLEEPBEFORE_END", nowMs(), currentEvent.lineNumber)
            }
            if (!currentEvent.handle(this, out)) {
                stats.transition(Stats.Transition.FAILED)
                out.printCsv(sessionId, "PLAYBACK_FAIL", nowMs(), currentEvent.lineNumber)
                return
            }
            lastEventCreated = currentEvent.created
        }
        stats.transition(Stats.Transition.DONE)
        out.printCsv(sessionId, "PLAYBACK_DONE", nowMs())
    }
}

fun nowMs() = Instant.now().toEpochMilli()

fun PrintWriter.printCsv(vararg columns: Any) {
    this.println(columns.joinToString(","))
    this.flush()
}

class Stats(val numSessions: Int) {
    enum class State { WAIT, RUN, DONE, FAIL }
    enum class Transition { RUNNING, FAILED, DONE }

    val stats = ConcurrentHashMap(mapOf(
            State.WAIT to numSessions,
            State.RUN to 0,
            State.DONE to 0,
            State.FAIL to 0
    ))

    fun transition(t: Transition) {
        stats.replaceAll { k, v ->
            when (Pair(t, k)) {
                Pair(Transition.RUNNING, State.WAIT) -> v - 1
                Pair(Transition.RUNNING, State.RUN) -> v + 1
                Pair(Transition.DONE, State.RUN) -> v - 1
                Pair(Transition.DONE, State.DONE) -> v + 1
                Pair(Transition.FAILED, State.RUN) -> v - 1
                Pair(Transition.FAILED, State.FAIL) -> v + 1
                else -> v
            }
        }
    }

    fun isComplete(): Boolean {
        return stats.entries
                .filter { setOf(Stats.State.RUN, Stats.State.WAIT).contains(it.key) }
                .sumBy { it.value }
                .equals(0)
    }

    override fun toString(): String {
        val copy = stats.toMap()
        return "Waiting: ${copy[State.WAIT]}, Running: ${copy[State.RUN]}, Failed: ${copy[State.FAIL]}, Done: ${copy[State.DONE]}"
    }
}

// Represents many users over the course of a test.
class LoadTest(
        val args: Array<String>,
        val httpUrl: String,
        // Path to input file created by shinycannon record
        val logPath: String,
        // Number of milliseconds to wait between starting sessions.
        val startIntervalMs: Int = 0,
        // Number of sessions to start
        val numSessions: Int,
        // Path of directory to place session logs
        val outputDir: File) {

    val columnNames = arrayOf("thread_id", "event", "timestamp", "input_line_number", "comment")

    fun run() {
        val log = readEventLog(logPath)
        check(log.size > 0) { "input log must not be empty" }
        val logger = KotlinLogging.logger {}

        val stats = Stats(numSessions)

        thread {
            while (!stats.isComplete()) {
                println("${Instant.now().toString()} - $stats")
                Thread.sleep(5000)
            }
            println("${Instant.now().toString()} - $stats")
        }

        for (i in 1..numSessions) {
            thread {
                val creds = listOf("SHINYCANNON_USER", "SHINYCANNON_PASS")
                        .mapNotNull { System.getenv(it) }
                        .takeIf { it.size == 2 }
                        ?.zipWithNext()
                        ?.first()

                val session = ShinySession(i, outputDir, httpUrl, log, logger, creds)
                val outputFile = outputDir.toPath().resolve(Paths.get("sessions", "$i.log")).toFile()
                outputFile.printWriter().use { out ->
                    try {
                        out.println("# " + args.joinToString(" "))
                        out.printCsv(*columnNames)
                        out.printCsv(i, "PLAYER_SESSION_CREATE", nowMs())
                        session.run(startIntervalMs * i, out, stats)
                    } finally {
                        session.end()
                    }
                }
            }
        }
    }
}

class Args(parser: ArgParser) {
    val logPath by parser.positional("Path to Shiny interaction log file")
    val sessions by parser.storing("Number of sessions to simulate. Default is 1.") { toInt() }
            .default(1)
    val appUrl by parser.storing("URL of the Shiny application to interact with")
    val outputDir by parser.storing("Path to directory to store session logs in for this test run")
            .default("test-logs-${Instant.now()}")
    val overwriteOutput by parser.flagging("Whether or not to delete the output directory before starting, if it exists already")
    val startInterval by parser.storing("Number of milliseconds to wait between starting sessions") { toInt() }
            .default(0)
    val logLevel by parser.storing("Log level (default: warn, available include: debug, info, warn, error)") {
        Level.toLevel(this.toUpperCase(), Level.WARN) as Level
    }.default(Level.INFO)
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
        val output = File(outputDir)
        if (output.exists()) {
            if (overwriteOutput) {
                output.deleteRecursively()
            } else {
                error("Output dir $outputDir already exists and --output-overwrite not set")
            }
        }

        output.mkdirs()
        output.toPath().resolve("sessions").toFile().mkdir()

        val fa = FileAppender()
        fa.layout = PatternLayout("%5p [%t] %d (%F:%L) - %m%n")
        fa.threshold = logLevel
        fa.file = output.toPath().resolve("detail.log").toString()
        fa.activateOptions()
        Logger.getRootLogger().addAppender(fa)

        println("Logging at $logLevel level to $outputDir/detail.log")

        val loadTest = LoadTest(args, appUrl, logPath, numSessions = sessions, outputDir = output, startIntervalMs = startInterval)
        loadTest.run()
    }
}
