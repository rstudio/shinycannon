package com.rstudio

import com.github.kittinunf.fuel.core.Response
import com.github.kittinunf.fuel.httpGet
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.neovisionaries.ws.client.*
import com.xenomachina.argparser.ArgParser
import com.xenomachina.argparser.default
import com.xenomachina.argparser.mainBody
import mu.KLogger
import mu.KotlinLogging
import java.io.File
import java.lang.Exception
import java.net.URI
import java.security.SecureRandom
import java.time.Instant
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.regex.Pattern

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

fun readEventLog(logPath: String): ArrayList<Event> {
    return File(logPath).readLines()
            .asSequence()
            .filterNot { it.startsWith("#") }
            .fold(ArrayList()) { events, line ->
                events.also { it.add(parseLine(line)) }
            }
}

fun randomHexString(numchars: Int): String {
    val r = SecureRandom()
    val sb = StringBuffer()
    while (sb.length < numchars) sb.append(Integer.toHexString(r.nextInt()))
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

fun replaceTokens(str: String,
                  allowedTokens: HashSet<String>,
                  tokenDictionary: HashMap<String, String>): String {

    val tokensInUrl = getTokens(str)
    if (allowedTokens.union(tokensInUrl) != allowedTokens) {
        val illegalTokens = tokensInUrl.filterNot { allowedTokens.contains(it) }
        throw Exception("$illegalTokens are illegal tokens")
    }

    return tokensInUrl.fold(str) { s, tokenName ->
        if (!tokenDictionary.containsKey(tokenName))
            throw Exception("$tokenName is an allowed token, but it isn't present in the dictionary")
        s.replace("\${$tokenName}", tokenDictionary[tokenName]!!, true)
    }
}

fun makeWsUrl(httpUrl: String): String {
    val uri = URI.create(httpUrl)
    return URI("ws", uri.userInfo, uri.host, uri.port, uri.path, uri.query, uri.fragment).toString()
}

fun parseMessage(msg: String): JsonObject? {
    val re = Pattern.compile("""^a\["([0-9A-F*]+#)?0\|m\|(.*)"\]${'$'}""")
    val matcher = re.matcher(msg)
    val json = JsonParser()
    if (matcher.find()) {
        val inner = json.parse("\"${matcher.group(2)}\"").asString
        return json.parse(inner).asJsonObject
    } else {
        return null
    }
}

class ShinySession(val appHTTPUrl: String,
                   var script: ArrayList<Event>,
                   val log: KLogger,
                   val awaitTimeout: Long = 5,
                   val awaitTimeoutUnit: TimeUnit = TimeUnit.SECONDS) {

    val allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID", "SESSION")
    val tokenDictionary: HashMap<String, String> = hashMapOf(
            Pair("ROBUST_ID", randomHexString(18)),
            Pair("SOCKJSID", "000/${randomHexString(8)}")
    )

    val appWSUrl = makeWsUrl(appHTTPUrl)
    var webSocket: WebSocket? = null
    val receivedWSMessage: LinkedBlockingQueue<String> = LinkedBlockingQueue(1)

    fun isDone(): Boolean {
        return script.size == 0
    }

    fun handle(event: Event) {
        when (event) {
            is WSEvent -> handle(event)
            is HTTPEvent -> handle(event)
        }

        log.debug { "Handled ${event}" }
    }

    fun httpGet(event: HTTPEvent): Response {
        val url = replaceTokens(event.url, allowedTokens, tokenDictionary)
        val response = (appHTTPUrl + url).httpGet().responseString().second
        if (response.statusCode != event.statusCode)
            throw Exception("Status code was ${response.statusCode} but expected ${event.statusCode}")
        return response
    }

    fun handle(event: HTTPEvent) {
        when (event.type) {
            // {"type":"REQ_HOME","created":"2017-12-14T16:43:32.748Z","method":"GET","url":"/","statusCode":200}
            HTTPEventType.REQ_HOME -> {
                val response = httpGet(event)
                val re = Pattern.compile("<base href=\"_w_([0-9a-z]+)/")
                val matcher = re.matcher(response.toString())
                if (matcher.find()) {
                    tokenDictionary["WORKER"] = matcher.group(1)
                } else {
                    throw Exception("Unable to parse worker ID from response to REQ_HOME event. (Perhaps you're running SS Open Source or in local development?)")
                }
            }
            // {"type":"REQ","created":"2017-12-14T16:43:34.045Z","method":"GET","url":"/_w_${WORKER}/__assets__/shiny-server.css","statusCode":200}
            HTTPEventType.REQ -> {
                httpGet(event)
            }
            // {"type":"REQ_TOK","created":"2017-12-14T16:43:34.182Z","method":"GET","url":"/_w_${WORKER}/__token__?_=1513269814000","statusCode":200}
            HTTPEventType.REQ_TOK -> {
                tokenDictionary["TOKEN"] = String(httpGet(event).data)
            }
            // {"type":"REQ_SINF","created":"2017-12-14T16:43:34.244Z","method":"GET","url":"/__sockjs__/n=${ROBUST_ID}/t=${TOKEN}/w=${WORKER}/s=0/info","statusCode":200}
            HTTPEventType.REQ_SINF -> {
                httpGet(event)
            }
        }
    }

    fun waitForMessage(expecting: WSEventType): String {
        log.debug { "Awaiting receive..." }
        val received = receivedWSMessage.poll(awaitTimeout, awaitTimeoutUnit)
        if (received == null) {
            throw TimeoutException("Timed out waiting to receive $expecting")
        } else {
            return received
        }
    }

    fun handle(event: WSEvent) {
        when (event.type) {
            // {"type":"WS_OPEN","created":"2017-12-14T16:43:34.273Z","url":"/__sockjs__/n=${ROBUST_ID}/t=${TOKEN}/w=${WORKER}/s=0/${SOCKJSID}/websocket"}
            WSEventType.WS_OPEN -> {
                if (webSocket != null) throw IllegalStateException("Tried to WS_OPEN but already have a websocket")
                var wsUrl = appWSUrl + replaceTokens(event.url!!, allowedTokens, tokenDictionary)
                webSocket = WebSocketFactory().createSocket(wsUrl, 5000).also {
                    it.addListener(object : WebSocketAdapter() {
                        override fun onTextMessage(sock: WebSocket, msg: String) {
                            if (msg.startsWith("a[\"ACK")) {
                                TODO("Ignore messages properly, see https://github.com/rstudio/proxyrec/blob/master/lib/shiny-events.js#L598")
                            } else {
                                log.debug { "WS Received: $msg" }
                                log.debug { "parsed: '${parseMessage(msg)}'"}
                                receivedWSMessage.add(replaceTokens(msg, allowedTokens, tokenDictionary))
                            }
                        }
                        override fun onStateChanged(websocket: WebSocket?, newState: WebSocketState?) {
                            log.debug { "New WS state: $newState" }
                        }
                        override fun onError(websocket: WebSocket?, cause: WebSocketException?) {
                            cause?.printStackTrace()
                        }
                    })
                    it.connect()
                }
            }
            // {"type":"WS_RECV","created":"2017-12-14T16:43:34.300Z","message":"o"}
            WSEventType.WS_RECV -> {
                if (event.message == null)
                    throw IllegalStateException("Expected WS_RECV but message wasn't specified")
                val received = waitForMessage(WSEventType.WS_RECV)
                //TODO("Token substitution needs to happen here")
                if (event.message != received)
                    throw IllegalStateException("Expected WS_RECV with message '${event.message}' but got message '$received'")
            }
            // {"type":"WS_SEND","created":"2017-12-14T16:43:34.306Z","message":"[\"0#0|o|\"]"}
            WSEventType.WS_SEND -> {
                val msg = replaceTokens(event.message!!, allowedTokens, tokenDictionary)
                webSocket!!.sendText(msg)
                log.debug { "WS Sent: '$msg'" }
            }
            // {"type":"WS_RECV_INIT","created":"2017-12-14T16:43:34.414Z","message":"a[\"1#0|m|{\\\\\"config\\\\\":{\\\\\"workerId\\\\\":\\\\\"${WORKER}\\\\\",\\\\\"sessionId\\\\\":\\\\\"${SESSION}\\\\\",\\\\\"user\\\\\":null}}\"]"}
            WSEventType.WS_RECV_INIT -> {
                TODO("Parse the response string properly and extract SESSION from it.")
            }
        }
    }

    fun step(iterations: Int = 1) {
        for (i in 1..iterations) {
            if (script.size > 0) {
                handle(script.get(0))
                script.removeAt(0)
            } else {
                throw IllegalStateException("Can't step; not expecting aout of events to send")
            }
        }
    }
}

class Args(parser: ArgParser) {
    val logPath by parser.positional("Path to Shiny interaction log file")
    val users by parser.storing("Number of users to simulate. Default is 1.") { toInt() }
            .default("1")
    val appUrl by parser.storing("URL of the Shiny application to interact with")
}

fun <T> ArrayList<T>.shallowCopy(): ArrayList<T> {
    return this.fold(kotlin.collections.ArrayList<T>()) {
        copy, x -> copy.also { it.add(x) }
    }
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        val log = readEventLog(logPath)
        val logger = KotlinLogging.logger {}
        val session = ShinySession(appUrl, log.shallowCopy(), logger, 5, TimeUnit.SECONDS)
        session.step(7)
        logger.debug { "Waiting 10 seconds to close websocket..." }
        Thread.sleep(10000)
        session.webSocket?.sendClose()
    }
}

fun main(args: Array<String>) {
    if (System.getProperty("user.name") == "alandipert") {
        _main(arrayOf("--users", "1", "--app-url", "http://localhost:3838/sample-apps/hello/", "geyser-short.log"))
    } else {
        _main(arrayOf("--users", "1", "--app-url", "http://10.211.55.6:3838/sample-apps/hello/", "hello.log"))
    }
}