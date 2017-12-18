package com.rstudio

import com.google.gson.JsonParser
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import mu.KLogger
import mu.KotlinLogging
import org.organicdesign.fp.collections.RrbTree
import java.io.File
import java.lang.Exception
import java.time.Instant
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.websocket.Session

sealed class Event

enum class HTTPEventType { REQ, REQ_HOME, REQ_SINF, REQ_TOK }
data class HTTPEvent(val type: HTTPEventType,
                     val created: Instant,
                     val url: String,
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

fun readEventLog(logPath: String): RrbTree<Event> {
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

class ShinySession(val targetUrl: String,
                   val script: RrbTree<Event>,
                   val log: KLogger) {

    var workerToken? = null
    var expecting: WSEvent? = null
    var wsSession: Session? = null
    val receivedEvent: LinkedBlockingQueue<WSEvent> = LinkedBlockingQueue(1)

    init {
        log.debug { "Hello ok!" }
    }

    fun isDone(): Boolean {
        return script.count() == 0
    }

    fun handleHTTP(event: HTTPEvent) {

    }

    fun handleWS(event: WSEvent) {

    }

    fun wsEventsEqual(event1: WSEvent, event2: WSEvent): Boolean {
        return false
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
            val nextEvent = script.get(0)
            when (nextEvent) {
                is HTTPEvent -> handleHTTP(nextEvent)
                is WSEvent -> handleWS(nextEvent)
            }
            script = script.without(0)
        } else {
            throw IllegalStateException("Can't step; not expecting an event, and out of events to send")
        }
    }
}

class Args(parser: ArgParser) {
    val logPath by parser.positional("Path to Shiny interaction log file")
    val users by parser.storing("Number of users to simulate. Default is 1.") { toInt() }
            .default("1")
    val targetUrl by parser.storing("URL of the Shiny application to interact with")
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        val session = ShinySession(targetUrl, readEventLog(logPath), KotlinLogging.logger {})
    }
}

//fun main(args: Array<String>) = _main(args)
fun main(args: Array<String>) = _main(arrayOf("--users", "1", "--target-url", "http://localhost:3838/hello", "geyser-short.log"))