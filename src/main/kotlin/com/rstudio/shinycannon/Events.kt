package com.rstudio.shinycannon

import com.google.gson.JsonParser
import com.neovisionaries.ws.client.WebSocket
import com.neovisionaries.ws.client.WebSocketAdapter
import com.neovisionaries.ws.client.WebSocketFactory
import com.neovisionaries.ws.client.WebSocketState
import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.client.config.CookieSpecs
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpPost
import org.apache.http.entity.FileEntity
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.http.util.EntityUtils
import java.io.PrintWriter
import java.nio.file.FileSystems
import java.nio.file.Paths
import java.time.Instant

fun canIgnore(message: String):Boolean {

    // Messages matching these regexes should be ignored.
    val ignorableRegexes = listOf(
            """^a\["ACK""",
            """^\["ACK""",
            """^h"""
    ).map(String::toRegex)
    for (re in ignorableRegexes)
        if (re.containsMatchIn(message)) return true

    // This special SockJS init message should not be ignored.
    if (message == "o") return false

    val messageObject = parseMessage(message)

    if (messageObject == null)
        throw IllegalStateException("Expected to be able to parse message: $message")

    // If the message contains any of ignorableKeys as a key, then we should ignore it.
    val ignorableKeys = setOf("busy", "progress", "recalculating")
    for (key in ignorableKeys) {
        if (messageObject.keySet().contains(key)) return true
    }

    // If the message has only one key, "custom", and if that key also points to
    // an object with one key, "reactlog", then ignore.
    if (messageObject.takeIf { it.keySet() == setOf("custom") }
            ?.get("custom")
            ?.asJsonObject
            ?.keySet() == setOf("reactlog")) {
        return true
    }

    val emptyMessage = JsonParser()
            .parse("""{"errors":[],"values":[],"inputMessages":[]}""")
            .asJsonObject
    if (messageObject == emptyMessage) return true

    return false
}

sealed class Event(open val begin: Long, open val lineNumber: Int) {
    open fun sleepBefore(session: ShinySession): Long = 0
    // Returning true means the session is still valid, continue. False means handling has failed, stop.
    abstract fun handle(session: ShinySession, out: PrintWriter): Boolean
    fun name() = this::class.java.typeName.split("$").last()

    fun tryLog(session: ShinySession, out: PrintWriter, body: () -> Unit): Boolean {
        out.printCsv(session.sessionId, session.workerId, session.iterationId, "${name()}_START", nowMs(), lineNumber, "")
        try {
            body()
            out.printCsv(session.sessionId, session.workerId, session.iterationId, "${name()}_END", nowMs(), lineNumber, "")
        } catch (t: Throwable) {
            // TODO Failure/closing: close the session instead of trying to continue
            out.printCsv(session.sessionId, session.workerId, session.iterationId, "FAIL", nowMs(), lineNumber, "")
            session.log.warn(t) { "${name()} failed (line: $lineNumber)" }
            return false
        }
        return true
    }

    companion object {
        private fun parseInstant(str: String) = Instant.parse(str).toEpochMilli()

        fun fromLine(lineNumber: Int, line: String): Event {
            val obj = JsonParser().parse(line).asJsonObject
            val begin = parseInstant(obj.get("begin").asString)
            val type = obj.get("type").asString
            return when (type) {
                "REQ_GET" -> Http.REQ_GET(begin,
                        lineNumber,
                        obj.get("url").asString,
                        obj.get("status").asInt)
                "REQ_HOME" -> Http.REQ_HOME(begin,
                        lineNumber,
                        obj.get("url").asString,
                        obj.get("status").asInt)
                "REQ_SINF" -> Http.REQ_SINF(begin,
                        lineNumber,
                        obj.get("url").asString,
                        obj.get("status").asInt)
                "REQ_TOK" -> Http.REQ_TOK(begin,
                        lineNumber,
                        obj.get("url").asString,
                        obj.get("status").asInt)
                "REQ_POST" -> Http.REQ_POST(begin,
                        lineNumber,
                        obj.get("status").asInt,
                        obj.get("url").asString,
                        if (obj.has("datafile")) obj.get("datafile").asString else null)
                "WS_OPEN" -> WS_OPEN(begin, lineNumber, obj.get("url").asString)
                "WS_RECV" -> WS_RECV(begin, lineNumber, obj.get("message").asString)
                "WS_RECV_BEGIN_UPLOAD" -> WS_RECV_BEGIN_UPLOAD(begin, lineNumber, obj.get("message").asString)
                "WS_RECV_INIT" -> WS_RECV_INIT(begin, lineNumber, obj.get("message").asString)
                "WS_SEND" -> WS_SEND(begin, lineNumber, obj.get("message").asString)
                "WS_CLOSE" -> WS_CLOSE(begin, lineNumber)
                else -> throw Exception("Unknown event type: $type")
            }
        }
    }

    // TODO With REQ_GET and REQ_POST in the new recording format, all of this needs to change significantly.
    sealed class Http(override val begin: Long,
                      override val lineNumber: Int,
                      open val url: String,
                      open val status: Int) : Event(begin, lineNumber) {

        fun statusEquals(status: Int): Boolean {
            val equalCodes = setOf(200, 304)
            return equalCodes.union(setOf(this.status, status)) == equalCodes
        }

        // TODO Candidate for becoming a method on ShinySession that takes url/status args
        fun get(session: ShinySession): String {
            val renderedUrl = session.replaceTokens(this.url)
            val url = URIBuilderTiny(session.httpUrl)
                    .appendRawPathsByString(renderedUrl)
                    .build()
                    .toString()

            val cfg = RequestConfig.custom()
                    .setCookieSpec(CookieSpecs.STANDARD)
                    .build()
            val client = HttpClientBuilder
                    .create()
                    .setDefaultCookieStore(session.cookieStore)
                    .setDefaultRequestConfig(cfg)
                    .build()
            val get = HttpGet(url)
            client.execute(get).use { response ->
                val body = EntityUtils.toString(response.entity)
                val gotStatus = response.statusLine.statusCode
                if (!this.statusEquals(response.statusLine.statusCode))
                    error("Status $gotStatus received, expected $status, URL: $url, Response body: $body")
                return body
            }
        }

        class REQ_GET(override val begin: Long,
                      override val lineNumber: Int,
                      override val url: String,
                      override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun sleepBefore(session: ShinySession) =
                    // TODO The calculation involving "begin" changes with the latest shinyloadtest output (begin/end fields)
                    if (session.webSocket == null) 0 else (begin - (session.lastEventEnded ?: begin))

            override fun handle(session: ShinySession, out: PrintWriter): Boolean {
                return tryLog(session, out) { get(session) }
            }
        }

        class REQ_HOME(override val begin: Long,
                       override val lineNumber: Int,
                       override val url: String,
                       override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter): Boolean {
                return tryLog(session, out) {
                    val response = get(session)
                    // session.get(this.url)
                    val re = """.*<base href="_w_([0-9a-z]+)/.*"""
                            .toRegex(options = setOf(RegexOption.MULTILINE, RegexOption.DOT_MATCHES_ALL))
                    val match = re.matchEntire(response)
                    val workerId = match?.groupValues?.getOrNull(1)
                    workerId?.let {
                        // Note: If workerId is null, we're probably running against dev server or SSO
                        session.tokenDictionary["WORKER"] = it
                    }
                }
            }
        }

        class REQ_SINF(override val begin: Long,
                       override val lineNumber: Int,
                       override val url: String,
                       override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter): Boolean {
                return tryLog(session, out) { get(session) }
            }
        }

        class REQ_TOK(override val begin: Long,
                      override val lineNumber: Int,
                      override val url: String,
                      override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter): Boolean {
                return tryLog(session, out) {
                    session.tokenDictionary["TOKEN"] = get(session)
                }
            }
        }

        class REQ_POST(override val begin: Long,
                       override val lineNumber: Int,
                       override val status: Int,
                       override val url: String,
                       val datafile: String?): Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter): Boolean {
                return tryLog(session, out) {
                    val url = URIBuilderTiny(session.httpUrl)
                            .appendRawPathsByString(session.replaceTokens(url))
                            .build()
                            .toString()
                    val cfg = RequestConfig.custom()
                            .setCookieSpec(CookieSpecs.STANDARD)
                            .build()
                    val client = HttpClientBuilder
                            .create()
                            .setDefaultCookieStore(session.cookieStore)
                            .setDefaultRequestConfig(cfg)
                            .build()
                    val post = HttpPost(url)

                    if (datafile != null) {
                        val parentDir = Paths.get(session.logPath).parent ?: FileSystems.getDefault().getPath(".")
                        val file = parentDir.resolve(datafile).toFile()
                        assert(file.exists() && file.isFile)
                        post.entity = FileEntity(file)
                    }

                    client.execute(post).use { response ->
                        val body = EntityUtils.toString(response.entity)
                        response.statusLine.statusCode.let {
                            check(it == status, {
                                "Status $it received, expected $status, URL: $url, Response body: $body"
                            })
                        }
                    }
                }
            }
        }
    }

    class WS_OPEN(override val begin: Long,
                  override val lineNumber: Int,
                  val url: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            check(session.webSocket == null) { "Tried to WS_OPEN but already have a websocket" }

            return tryLog(session, out) {
                val wsUrl = session.wsUrl + session.replaceTokens(url)
                session.webSocket = WebSocketFactory().createSocket(wsUrl).also {
                    it.addListener(object : WebSocketAdapter() {
                        override fun onTextMessage(sock: WebSocket, msg: String) {
                            if (canIgnore(msg)) {
                                session.log.debug { "%%% Ignoring $msg" }
                            } else {
                                session.log.debug { "%%% Received: $msg" }
                                if (!session.receiveQueue.offer(session.replaceTokens(msg))) {
                                    throw Exception("receiveQueue is full (max = ${session.receiveQueueSize})")
                                }
                            }
                        }
                        // TODO Failure/closing: end the session when the server closes the websocket
                        override fun onStateChanged(websocket: WebSocket?, newState: WebSocketState?) =
                                session.log.debug { "%%% State $newState" }
                    })

                    it.addHeader("Cookie", session
                            .cookieStore
                            .cookies
                            .map { "${it.name}=${it.value}" }
                            .joinToString("; "))

                    it.connect()
                }
            }
        }
    }

    class WS_RECV(override val begin: Long,
                  override val lineNumber: Int,
                  val message: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            return tryLog(session, out) {
                // Waits indefinitely for a message to become available
                // TODO Look into how to shut down properly for each WS_RECV_* type. Consider shutdown exception or shutdown sentinel
                val receivedStr = session.receiveQueue.take()
                session.log.debug { "WS_RECV received: $receivedStr" }
                // Because the messages in our log file are extra-escaped, we need to unescape once.
                val expectingStr = session.replaceTokens(message)
                val expectingObj = parseMessage(expectingStr)
                if (expectingObj == null) {
                    check(expectingStr == receivedStr) {
                        "Expected string $expectingStr but got $receivedStr"
                    }
                } else {
                    // TODO Do full structural comparison instead of just comparing top-level keys
                    val receivedObj = parseMessage(receivedStr)
                    check(expectingObj.keySet() == receivedObj?.keySet()) {
                        "Objects don't have same keys: $expectingObj, $receivedObj"
                    }
                }
            }
        }
    }

    class WS_RECV_INIT(override val begin: Long,
                       override val lineNumber: Int,
                       val message: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            return tryLog(session, out) {
                // Waits indefinitely for a message to become available
                val receivedStr = session.receiveQueue.take()
                session.log.debug { "WS_RECV_INIT received: $receivedStr" }

                val sessionId = parseMessage(receivedStr)
                        ?.get("config")
                        ?.asJsonObject
                        ?.get("sessionId")
                        ?.asString
                        ?: throw IllegalStateException("Expected sessionId from WS_RECV_INIT message")

                session.tokenDictionary["SESSION"] = sessionId
                session.log.debug { "WS_RECV_INIT got SESSION: ${session.tokenDictionary["SESSION"]}" }
            }
        }
    }

    class WS_RECV_BEGIN_UPLOAD(override val begin: Long,
                               override val lineNumber: Int,
                               val message: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            return tryLog(session, out) {
                // Waits indefinitely for a message to become available
                val receivedStr = session.receiveQueue.take()
                session.log.debug { "WS_RECV_BEGIN_UPLOAD received: $receivedStr" }

                val jobId = parseMessage(receivedStr)
                        ?.get("response")
                        ?.asJsonObject
                        ?.get("value")
                        ?.asJsonObject
                        ?.get("jobId")
                        ?.asString
                        ?: error("Expected jobId from WS_RECV_BEGIN_UPLOAD message")

                session.tokenDictionary["UPLOAD_JOB_ID"] = jobId

                session.log.debug { "WS_RECV_BEGIN_UPLOAD got jobId: $jobId" }
            }
        }
    }

    class WS_SEND(override val begin: Long,
                  override val lineNumber: Int,
                  val message: String) : Event(begin, lineNumber) {
        override fun sleepBefore(session: ShinySession) =
                begin - (session.lastEventEnded ?: begin)

        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            return tryLog(session, out) {
                val text = session.replaceTokens(message)
                session.webSocket!!.sendText(text)
                session.log.debug { "WS_SEND sent: $text" }
            }
        }
    }

    class WS_CLOSE(override val begin: Long,
                   override val lineNumber: Int) : Event(begin, lineNumber) {
        override fun sleepBefore(session: ShinySession) =
                begin - (session.lastEventEnded ?: begin)

        override fun handle(session: ShinySession, out: PrintWriter): Boolean {
            return tryLog(session, out) {
                session.webSocket!!.disconnect()
                session.log.debug { "WS_CLOSE sent" }
            }
        }
    }
}