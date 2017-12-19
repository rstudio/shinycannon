package com.rstudio

import com.github.kittinunf.fuel.core.Response
import com.github.kittinunf.fuel.httpGet
import com.google.gson.JsonParser
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import mu.KLogger
import mu.KotlinLogging
import org.organicdesign.fp.collections.PersistentHashMap
import org.organicdesign.fp.collections.RrbTree
import java.io.File
import java.lang.Exception
import java.security.SecureRandom
import java.time.Instant
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern
import javax.websocket.Session

sealed class Event

enum class HTTPEventType { REQ, REQ_HOME, REQ_SINF, REQ_TOK }
data class HTTPEvent(val type: HTTPEventType,
                     val created: Instant,
                     val url: String,
                     val method: String,
                     val statusCode: Int) : Event()

enum class WSEventType { WS_OPEN, WS_RECV, WS_RECV_INIT, WS_SEND }
data class WSEvent(val type: WSEventType,
                   val created: Instant,
                   val url: String?,
                   val message: String?) : Event()

fun parseLine(line: String): Event {
    val obj = JsonParser().parse(line).asJsonObject
    when (obj.get("type").asString) {
        in HTTPEventType.values().map { it.name } ->
            return HTTPEvent(HTTPEventType.valueOf(obj.get("type").asString),
                    Instant.parse(obj.get("created").asString),
                    obj.get("url").asString,
                    obj.get("method").asString,
                    obj.get("statusCode").asInt)
        in WSEventType.values().map { it.name } ->
            return WSEvent(WSEventType.valueOf(obj.get("type").asString),
                    Instant.parse(obj.get("created").asString),
                    obj.get("url")?.asString,
                    obj.get("message")?.asString)
        else -> {
            throw Exception("Failed to parse log entry: $line")
        }
    }
}

fun readEventLog(logPath: String): RrbTree<out Event> {
    return File(logPath).readLines()
            .asSequence()
            .filterNot { it.startsWith("#") }
            .fold(RrbTree.empty<Event>()) { events, line ->
                events.append(parseLine(line))
            }
}

fun wsEventsEqual(e1: WSEvent, e2: WSEvent): Boolean {
    return true;
}

// mirNTMNTw2zWVwTu7P is an example
fun getRandomHexString(numchars: Int = 18): String {
    val r = SecureRandom()
    val sb = StringBuffer()
    while (sb.length < numchars) {
        sb.append(Integer.toHexString(r.nextInt()))
    }
    return sb.toString().substring(0, numchars)
}

fun getTokens(url: String): HashSet<String> {
    val tokens = HashSet<String>()
    for (token in Regex("""\$\{([A-Z_]+)}""" ).findAll(url)) {
        // we know the next line is safe because: token.groups.forEach { println(it) }
        tokens.add(token.groups[1]!!.value)
    }
    return tokens
}

fun tokenizeUrl(url: String, tokens: HashSet<String>,
                allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID"),
                urlDictionary: PersistentHashMap<String, String> =  PersistentHashMap.empty<String, String>()
                        .assoc("ROBUST_ID", getRandomHexString())): String {
    tokens.forEach { token ->
        if (token in allowedTokens) {
            val value: String = urlDictionary[token] ?:
                    throw Exception("${token} is an allowed token, but it isn't present in the dictionary")
            url.replace("\${${token}}", value, false)
            println(url)
        } else {
            throw Exception("${token} is not an allowed token")
        }
    }
    return url
}

class ShinySession(val appUrl: String,
                   var script: RrbTree<out Event>,
                   val log: KLogger) {

    var workerId: String? = null
    var sessionToken: String? = null
    var robustId: String = getRandomHexString()
    var expecting: WSEvent? = null
    var wsSession: Session? = null
    val receivedEvent: LinkedBlockingQueue<WSEvent> = LinkedBlockingQueue(1)


    init {
        log.debug { "Hello ok!" }
    }

    fun isDone(): Boolean {
        return script.size == 0
    }

    fun wsEventsEqual(event1: WSEvent, event2: WSEvent): Boolean {
        return false
    }

    fun handle(event: Event) {
        when(event) {
            is WSEvent -> handle(event)
            is HTTPEvent -> handle(event)
        }
    }

    fun handle(event: WSEvent) {
    }

    fun handle(event: HTTPEvent) {

        fun getResponse(event: HTTPEvent, workerIdRequired: Boolean = true): Response {
            val url = tokenizeUrl(event.url, getTokens(event.url))
            val response = (appUrl + url).httpGet().responseString().second
            if (response.statusCode != event.statusCode)
                throw Exception("Status code was ${response.statusCode} but expected ${event.statusCode}")
            return response
        }

        when (event.type) {
            // {"type":"REQ_HOME","created":"2017-12-14T16:43:32.748Z","method":"GET","url":"/","statusCode":200}
            HTTPEventType.REQ_HOME -> {
                val response = getResponse(event, false)
                val re = Pattern.compile("<base href=\"_w_([0-9a-z]+)/")
                val matcher = re.matcher(response.toString())
                if (matcher.find()) {
                    workerId = matcher.group(1)
                } else {
                    throw Exception("Unable to parse worker ID from response to REQ_HOME event. (Perhaps you're running SS Open Source or in local development?)")
                }
            }
            // {"type":"REQ","created":"2017-12-14T16:43:34.045Z","method":"GET","url":"/_w_${WORKER}/__assets__/shiny-server.css","statusCode":200}
            HTTPEventType.REQ -> {
                val response = getResponse(event)
            }
            // {"type":"REQ_TOK","created":"2017-12-14T16:43:34.182Z","method":"GET","url":"/_w_${WORKER}/__token__?_=1513269814000","statusCode":200}
            HTTPEventType.REQ_TOK -> {
                sessionToken = String(getResponse(event).data)
            }
            // {"type":"REQ_SINF","created":"2017-12-14T16:43:34.244Z","method":"GET","url":"/__sockjs__/n=${ROBUST_ID}/t=${TOKEN}/w=${WORKER}/s=0/info","statusCode":200}
            HTTPEventType.REQ_SINF -> {
                val response = getResponse(event)
            }
        }

        log.debug { "Handled ${event}" }
    }

    fun step() {
        if (expecting != null) {
            log.debug { "Expecting a websocket response..." }
            val received = receivedEvent.poll(5, TimeUnit.SECONDS)
            if (wsEventsEqual(expecting!!, received)) {
                expecting = null
                log.debug { "Expected ${expecting} and was pleasantly surprised to receive ${received}" }
            } else {
                throw IllegalStateException("Expected ${expecting} but received ${received}")
            }
        } else if (script.size > 0) {
            handle(script.get(0))
            script.without(0)
        } else {
            throw IllegalStateException("Can't step; not expecting an event, and out of events to send")
        }
    }
}

class Args(parser: ArgParser) {
    val logPath by parser.positional("Path to Shiny interaction log file")
    val users by parser.storing("Number of users to simulate. Default is 1.") { toInt() }
            .default("1")
    val appUrl by parser.storing("URL of the Shiny application to interact with")
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        var log = readEventLog(logPath)
        val session = ShinySession(appUrl, log, KotlinLogging.logger {})
        session.step()
        session.step()
        session.step()
//        while (!session.isDone())
//            session.step()
//        val log = readEventLog(logPath)
//        log.listIterator().forEach { println(it) }
    }
}

//fun main(args: Array<String>) = _main(arrayOf("hello.log"))
//fun main(args: Array<String>) = _main(args)
//fun main(args: Array<String>) = _main(arrayOf("--users", "1", "--app-url", "http://localhost:3838/sample-apps/hello/", "geyser-short.log"))
fun main(args: Array<String>) = _main(arrayOf("--users", "1", "--app-url", "http://10.211.55.6:3838/sample-apps/hello/", "hello.log"))