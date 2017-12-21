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
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.regex.Pattern

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

class ShinySession(val httpUrl: String,
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
        check(script.size > 0) { "script must not be empty" }
        lastEventCreated = script.get(0).created
    }

    fun replaceTokens(s: String) = replaceTokens(s, allowedTokens, tokenDictionary)

    fun waitForMessage(): String {
        return receiveQueue.poll(awaitTimeoutMs.toLong(), TimeUnit.MILLISECONDS) ?:
                throw TimeoutException("Timed out waiting for message")
    }

    fun step(iterations: Int = 1) {
        for (i in 1..iterations) {
            log.debug { "iteration = $i" }
            if (script.size > 0) {
                val currentEvent = script.get(0)
                Thread.sleep(currentEvent.sleepBefore(this))
                currentEvent.handle(this)
                lastEventCreated = currentEvent.created
                script.removeAt(0)
            } else {
                throw IllegalStateException("Can't step, out of events")
            }
        }
    }

    fun end() {
        webSocket?.sendClose()
    }
}

class Args(parser: ArgParser) {
    val logPath by parser.positional("Path to Shiny interaction log file")
    val users by parser.storing("Number of users to simulate. Default is 1.") { toInt() }
            .default("1")
    val appUrl by parser.storing("URL of the Shiny application to interact with")
}

fun <T> ArrayList<T>.shallowCopy(): ArrayList<T> {
    return this.fold(kotlin.collections.ArrayList<T>()) { copy, x ->
        copy.also { it.add(x) }
    }
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        val log = readEventLog(logPath)
        val logger = KotlinLogging.logger {}
        val session = ShinySession(appUrl, log.shallowCopy(), logger, 5, 5000, 5000)
        session.step(24)
        logger.debug { "Sleeping for 5 seconds" }
        Thread.sleep(5000)
        logger.debug { "Done sleeping, closing websocket" }
        session.end()
    }
}

fun main(args: Array<String>) {
    if (System.getProperty("user.name") == "alandipert") {
        _main(arrayOf("--users", "1", "--app-url", "http://localhost:3838/sample-apps/hello/", "hello2.log"))
    } else {
        _main(arrayOf("--users", "1", "--app-url", "http://10.211.55.6:3838/sample-apps/hello/", "hello.log"))
    }
}