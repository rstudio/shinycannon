package com.rstudio.proxyrec

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.neovisionaries.ws.client.WebSocket
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import mu.KLogger
import mu.KotlinLogging
import net.moznion.uribuildertiny.URIBuilderTiny
import java.io.File
import java.lang.Exception
import java.security.SecureRandom
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.regex.Pattern
import java.time.Instant
import kotlin.concurrent.thread

fun readEventLog(logPath: String): ArrayList<Event> {
    return File(logPath).readLines()
            .asSequence()
            .filterNot { it.startsWith("#") }
            .fold(ArrayList()) { events, line ->
                events.also { it.add(Event.fromLine(line)) }
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

fun <T> ArrayList<T>.shallowCopy(): ArrayList<T> {
    return this.fold(kotlin.collections.ArrayList<T>()) { copy, x ->
        copy.also { it.add(x) }
    }
}

// Represents a single "user" during the course of a LoadTest.
class ShinySession(val sessionId: Int,
                   val outputDir: File,
                   val httpUrl: String,
                   var script: ArrayList<Event>,
                   val log: KLogger,
                   val receiveQueueSize: Int = 5,
                   val wsConnectTimeoutMs: Int = 5000,
                   val awaitTimeoutMs: Int = 5000) {

    val wsUrl: String = URIBuilderTiny(httpUrl).setScheme("ws").build().toString()

    val allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID", "SESSION")
    val tokenDictionary: HashMap<String, String> = hashMapOf(
            Pair("ROBUST_ID", randomHexString(18)),
            Pair("SOCKJSID", "000/${randomHexString(8)}")
    )

    var webSocket: WebSocket? = null
    val receiveQueue: LinkedBlockingQueue<String> = LinkedBlockingQueue(receiveQueueSize)

    var lastEventCreated: Long

    init {
        lastEventCreated = script.get(0).created
    }

    fun replaceTokens(s: String) = replaceTokens(s, allowedTokens, tokenDictionary)

    fun waitForMessage(): String {
        return receiveQueue.poll(awaitTimeoutMs.toLong(), TimeUnit.MILLISECONDS) ?:
                throw TimeoutException("Timed out waiting for message")
    }

    fun step(iterations: Int = 1) {
        for (i in 1..iterations) {
            //log.debug { "iteration = $i" }
            if (script.size > 0) {
                val currentEvent = script.get(0)
                Thread.sleep(currentEvent.sleepBefore(this))
                currentEvent.handle(this)
                // Things we're writing to each line of the log:
                // Step #, Event type, Sleep time (ms), Elapsed time (ms), Finished timestamp (epoch ms), Finished timestamp (ISO datestime), Succeeded (true/false)
                // stepNumber, eventType, elapsedMs, finishedMs, finishedAtMs, finishedAtTimestamp, succeeded
                // 33, "WS_SEND", 534, 423, 340294427947, "2018-01-08 13:34:32.32Z", true
                lastEventCreated = currentEvent.created
                script.removeAt(0)
            } else {
                throw IllegalStateException("Can't step, out of events")
            }
        }
    }

    fun replay() {
        TODO("Run through the original script using the same websocket, session, etc.")
    }

    fun end() {
        log.debug { "Ending session" }
        // TODO either assert that there are no pending inbound messages, OR warn about them?
        // Thread.sleep(1000)
        // check( (webSocket?.isOpen ?: false) ) {"Websocket should already be closed"}
    }
    fun run() = step(script.size)
}

// Represents many users over the course of a test.
class LoadTest(val httpUrl: String,
                // Path to input file created by proxyrec record
               val logPath: String,
               val receiveQueueSize: Int = 5,
               val wsConnectTimeoutMs: Int = 5000,
               val awaitTimeoutMs: Int = 5000,
               // Number of milliseconds to wait between starting sessions.
               val startDelayMs: Int = 0,
               // Number of sessions to start
               val numSessions: Int,
               // Path of directory to place session logs
               val outputDir: File) {

    fun run() {
        val log = readEventLog(logPath)
        check(log.size > 0) { "input log must not be empty" }
        val logger = KotlinLogging.logger {}
        for (i in 1..numSessions) {
            Thread.sleep(startDelayMs.toLong())
            thread {
                val session = ShinySession(i,
                        outputDir,
                        httpUrl,
                        log.shallowCopy(),
                        logger,
                        5,
                        5000,
                        500000000)
                try {
                    session.run()
                } finally {
                    session.end()
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
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        val output = File(outputDir)
        check(!output.exists()) { "Output dir already exists" }
        output.mkdirs()
        val loadTest = LoadTest(appUrl, logPath, numSessions = sessions, outputDir = output)
        loadTest.run()
    }
}

//fun main(args: Array<String>) = _main(args)
fun main(args: Array<String>) {
    if (System.getProperty("user.name") == "alandipert") {
        _main(arrayOf("--output-dir", "test-${Instant.now()}", "--sessions", "1", "--app-url", "http://localhost:8080/content/1/", "hello-connect.log"))
    } else {
        _main(arrayOf("--output-dir", "test-${Instant.now()}", "--sessions", "1", "--app-url", "http://shinyloadtest.rstudioservices.com/content/2/", "hello-connect.log"))
    }
}
