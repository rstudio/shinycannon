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
import javax.websocket.*

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

fun readEventLog(logPath: String): ArrayList<out Event> {
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

    return tokensInUrl.fold(str) { str, tokenName ->
        if (!tokenDictionary.containsKey(tokenName))
            throw Exception("$tokenName is an allowed token, but it isn't present in the dictionary")
        str.replace("\${$tokenName}", tokenDictionary[tokenName]!!, true)
    }
}

fun makeWsUrl(httpUrl: String): String {
    val uri = URI.create(httpUrl)
    return URI("ws", uri.userInfo, uri.host, uri.port, uri.path, uri.query, uri.fragment).toString()
}

class ShinySession(val appHTTPUrl: String,
                   var script: ArrayList<out Event>,
                   val log: KLogger) {

    val allowedTokens: HashSet<String> = hashSetOf("WORKER", "TOKEN", "ROBUST_ID", "SOCKJSID", "SESSION")
    val tokenDictionary: HashMap<String, String> = hashMapOf(
            Pair("ROBUST_ID", randomHexString(18)),
            Pair("SOCKJSID", "000/${randomHexString(8)}")
    )

    val appWSUrl = makeWsUrl(appHTTPUrl)
    var expecting: Pair<WSEventType, String?>? = null
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

    fun handle(event: WSEvent) {
        when (event.type) {
            // {"type":"WS_OPEN","created":"2017-12-14T16:43:34.273Z","url":"/__sockjs__/n=${ROBUST_ID}/t=${TOKEN}/w=${WORKER}/s=0/${SOCKJSID}/websocket"}
            WSEventType.WS_OPEN -> {
                if (webSocket != null) throw IllegalStateException("Tried to WS_OPEN but already have a websocket")
                var wsUrl = appWSUrl + replaceTokens(event.url!!, allowedTokens, tokenDictionary)
                webSocket = WebSocketFactory().createSocket(wsUrl, 5000).also {
                    it.addListener(object : WebSocketAdapter() {
                        override fun onTextMessage(sock: WebSocket, msg: String) {
                            log.debug { "WS Received: $msg" }
                            receivedWSMessage.add(replaceTokens(msg, allowedTokens, tokenDictionary))
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
                expecting = Pair(WSEventType.WS_RECV, replaceTokens(event.message!!, allowedTokens, tokenDictionary))
                log.debug { "Now expecting WS_RECV" }
                step()
            }
            // {"type":"WS_SEND","created":"2017-12-14T16:43:34.306Z","message":"[\"0#0|o|\"]"}
            WSEventType.WS_SEND -> {
                val msg = replaceTokens(event.message!!, allowedTokens, tokenDictionary)
                webSocket!!.sendText(msg)
                log.debug { "WS Sent: $msg" }
            }
            // {"type":"WS_RECV_INIT","created":"2017-12-14T16:43:34.414Z","message":"a[\"1#0|m|{\\\\\"config\\\\\":{\\\\\"workerId\\\\\":\\\\\"${WORKER}\\\\\",\\\\\"sessionId\\\\\":\\\\\"${SESSION}\\\\\",\\\\\"user\\\\\":null}}\"]"}
            WSEventType.WS_RECV_INIT -> {
                expecting = Pair(WSEventType.WS_RECV_INIT, null)
                log.debug { "Now expecting WS_RECV_INIT" }
                step()
            }
        }
    }

    fun parseWsRecvInitMsg(msg: String): JsonObject {
        val re = Pattern.compile("^a\\\\[\\\"([0-9A-F*]+#)?0\\\\|m\\\\|(.*)\\\"\\\\]\$")
        val matcher = re.matcher(msg)
        val json = JsonParser()
        if (matcher.find()) {
            return json.parse(json.parse(matcher.group(2)).asString).asJsonObject
        } else {
            throw Exception("Unable to parse WS_RECV_INIT message: $msg")
        }
    }

    fun receive(received: String) {
        val (expectedType, expectedMsg) = expecting!!
        when (expectedType) {
            WSEventType.WS_RECV -> {
                if (expectedMsg == null)
                    throw IllegalStateException("Expected WS_RECV but message wasn't specified")
                if (expectedMsg != received)
                    throw IllegalStateException("Expected WS_RECV with message '${expectedMsg}' but got message '$received'")
                log.debug { "Received WS_RECV message" }
                expecting = null
            }
            WSEventType.WS_RECV_INIT -> {
                val obj = parseWsRecvInitMsg(received)
                tokenDictionary["SESSION"] = obj.get("config").asJsonObject.get("sessionId").asString
                log.debug { "Received WS_RECV_INIT and set SESSION='${tokenDictionary["SESSION"]}" }
                expecting = null
            }
        }
    }

    fun step() {
        if (expecting != null) {
            log.debug { "Awaiting receive..." }
            val received: String? = receivedWSMessage.poll(5, TimeUnit.SECONDS)
            if (received == null) {
                throw TimeoutException("Timed out waiting to receive $expecting")
            } else {
                receive(received)
            }
        } else if (script.size > 0) {
            handle(script.get(0))
            script.removeAt(0)
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

fun copyLog(oldScript: ArrayList<out Event>): ArrayList<out Event> {
    return oldScript.fold(ArrayList<Event>()) { copy, item ->
        copy.also { it.add(item) }
    }
}

fun _main(args: Array<String>) = mainBody("player") {
    Args(ArgParser(args)).run {
        val log = readEventLog(logPath)
        val session = ShinySession(appUrl, copyLog(log), KotlinLogging.logger {})
        session.step()
        session.step()
        session.step()
        session.step()
        // websocket party time
        session.step() // WS_OPEN - creates, connects websocket
        session.step() // WS_RECV - sets expecting = event.message, steps once more to await
        session.step() // WS_SEND
        session.step() // WS_SEND
        session.step() // WS_RECV
//        session.step() // block on receive from message queue
//        session.step() // WS_SEND
        session.webSocket!!.sendClose()
//        while (!session.isDone())
//            session.step()
//        val log = readEventLog(logPath)
//        log.listIterator().forEach { println(it) }
    }
}

fun main(args: Array<String>) {
    if (System.getProperty("user.name") == "alandipert") {
        _main(arrayOf("--users", "1", "--app-url", "http://localhost:3838/sample-apps/hello/", "geyser-short.log"))
    } else {
        _main(arrayOf("--users", "1", "--app-url", "http://10.211.55.6:3838/sample-apps/hello/", "hello.log"))
    }
}