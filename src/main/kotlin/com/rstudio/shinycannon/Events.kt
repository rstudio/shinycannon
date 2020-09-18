package com.rstudio.shinycannon

import com.google.gson.JsonParser
import com.neovisionaries.ws.client.*
import org.apache.http.client.config.CookieSpecs
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpPost
import org.apache.http.entity.FileEntity
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.http.util.EntityUtils
import org.joda.time.Instant
import java.io.PrintWriter
import java.nio.file.FileSystems
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

fun canIgnore(message: String):Boolean {

    // Messages matching these regexes should be ignored.
    val ignorableRegexes = listOf(
            """^a\["ACK""",
            """^\["ACK""",
            """^h$"""
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

fun joinPaths(p1: String, p2: String): String {
    return when(Pair(p1.endsWith("/"), p2.startsWith("/"))) {
        Pair(true, true) -> p1 + p2.substring(1)
        Pair(true, false), Pair(false, true) -> p1 + p2
        else -> p1 + "/" + p2
    }
}

sealed class Event(open val begin: Long, open val lineNumber: Int) {
    open fun sleepBefore(session: ShinySession): Long = 0

    abstract fun handle(session: ShinySession, out: PrintWriter)

    // Here we use Class.toString instead of Class.getTypeName in order to work on Java 7.
    fun name() = this::class.java.toString().split("$").last()

    fun withLog(session: ShinySession, out: PrintWriter, body: () -> Unit) {
        out.printCsv(session.sessionId, session.workerId, session.iterationId, "${name()}_START", nowMs(), lineNumber, "")
        body()
        out.printCsv(session.sessionId, session.workerId, session.iterationId, "${name()}_END", nowMs(), lineNumber, "")
    }

    companion object {
        private fun parseInstant(str: String) = Instant.parse(str).millis

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
            return this.status == status
                    || (this.status == 200 && status == 304)
                    || (this.status == 304 && status == 200)
        }

        // TODO Candidate for becoming a method on ShinySession that takes url/status args
        fun get(session: ShinySession): String {
            val renderedUrl = session.replaceTokens(this.url)
            val url = joinPaths(session.httpUrl, renderedUrl)

            val cfg = RequestConfig.custom()
                    .setCookieSpec(CookieSpecs.STANDARD)
                    .build()
            val client = HttpClientBuilder
                    .create()
                    .setDefaultCookieStore(session.cookieStore)
                    .setDefaultRequestConfig(cfg)
                    .setUserAgent(getUserAgent())
                    .build()
            val get = HttpGet(url).addHeaders(session.headers)
            client.execute(get).use { response ->
                val body = EntityUtils.toString(response.entity)
                val gotStatus = response.statusLine.statusCode
                if (!this.statusEquals(gotStatus))
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

            override fun handle(session: ShinySession, out: PrintWriter) {
                withLog(session, out) { get(session) }
            }
        }

        class REQ_HOME(override val begin: Long,
                       override val lineNumber: Int,
                       override val url: String,
                       override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter) {
                withLog(session, out) {
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
            override fun handle(session: ShinySession, out: PrintWriter) {
                withLog(session, out) { get(session) }
            }
        }

        class REQ_TOK(override val begin: Long,
                      override val lineNumber: Int,
                      override val url: String,
                      override val status: Int) : Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter) {
                withLog(session, out) {
                    session.tokenDictionary["TOKEN"] = get(session)
                }
            }
        }

        class REQ_POST(override val begin: Long,
                       override val lineNumber: Int,
                       override val status: Int,
                       override val url: String,
                       val datafile: String?): Http(begin, lineNumber, url, status) {
            override fun handle(session: ShinySession, out: PrintWriter) {
                withLog(session, out) {
                    val url = joinPaths(session.httpUrl, session.replaceTokens(url))
                    val cfg = RequestConfig.custom()
                            .setCookieSpec(CookieSpecs.STANDARD)
                            .build()
                    val client = HttpClientBuilder
                            .create()
                            .setDefaultCookieStore(session.cookieStore)
                            .setDefaultRequestConfig(cfg)
                            .setUserAgent(getUserAgent())
                            .build()
                    val post = HttpPost(url).addHeaders(session.headers)

                    if (datafile != null) {
                        val parentDir = session.recording.toPath().parent ?: FileSystems.getDefault().getPath(".")
                        val file = parentDir.resolve(datafile).toFile()
                        assert(file.exists() && file.isFile)
                        post.entity = FileEntity(file)
                    }

                    client.execute(post).use { response ->
                        response.statusLine.statusCode.let {
                            check(it == status, {
                                val body = response.entity?.let { EntityUtils.toString(it) } ?: ""
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
        override fun handle(session: ShinySession, out: PrintWriter) {
            check(session.webSocket == null) { "Tried to WS_OPEN but already have a websocket" }

            withLog(session, out) {
                val wsUrl = session.wsUrl.appendRawPathsByString(session.replaceTokens(url)).build()
                session.webSocket = WebSocketFactory().createSocket(wsUrl).also {
                    it.addListener(object : WebSocketAdapter() {
                        override fun onTextMessage(sock: WebSocket, msg: String) {
                            if (canIgnore(msg)) {
                                session.logger.debug("%%% Ignoring $msg")
                            } else {
                                session.logger.debug("%%% Received: $msg")
                                if (!session.receiveQueue.offer(WSMessage.String(session.replaceTokens(msg)))) {
                                    throw Exception("receiveQueue is full (max = ${session.receiveQueueSize})")
                                }
                            }
                        }

                        // onError might be called multiple times, which could result in session.failure being
                        // set multiple times. This means that the value of session.failure that ultimately
                        // causes the session's run-loop to terminate might not be the first error that occurred.
                        // I think that's OK for now.
                        override fun onError(websocket: WebSocket, cause: WebSocketException) {
                            session.fail(cause)
                        }

                        override fun onDisconnected(websocket: WebSocket, serverCloseFrame: WebSocketFrame, clientCloseFrame: WebSocketFrame, closedByServer: Boolean) {
                            // In normal operation, the server should never close the websocket.
                            if (closedByServer) {
                                session.fail("Server closed websocket connection")
                            }
                        }
                    })

                    it.addHeader("Cookie", session
                            .cookieStore
                            .cookies
                            .map { "${it.name}=${it.value}" }
                            .joinToString("; "))

                    session.headers.forEach { h -> it.addHeader(h.name, h.value) }

                    it.addHeader("user-agent", getUserAgent())

                    it.connect()
                }
            }
        }
    }

    // Waits indefinitely for a message to become available but prints a warning
    // every 30 seconds if one hasn't been received yet.
    fun keepPolling(queue: LinkedBlockingQueue<WSMessage>,
                    timeoutSeconds: Long = 30,
                    warnFun: (Long) -> Unit): String {
        var elapsed = timeoutSeconds
        while (true) {
            queue.poll(timeoutSeconds, TimeUnit.SECONDS)?.let { msg ->
                when (msg) {
                    is WSMessage.Error -> throw msg.err
                    is WSMessage.String -> return msg.str
                }
            }
            warnFun(elapsed)
            elapsed += timeoutSeconds
        }
    }

    class WS_RECV(override val begin: Long,
                  override val lineNumber: Int,
                  val message: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter) {
            withLog(session, out) {
                val receivedStr = keepPolling(session.receiveQueue) {
                    session.logger.warn("WS_RECV line ${lineNumber}: Haven't received message after $it seconds")
                }
                session.logger.debug("WS_RECV received: $receivedStr")
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
        override fun handle(session: ShinySession, out: PrintWriter) {
            withLog(session, out) {
                val receivedStr = keepPolling(session.receiveQueue) {
                    session.logger.warn("WS_RECV_INIT line ${lineNumber}: Haven't received message after $it seconds")
                }
                session.logger.debug("WS_RECV_INIT received: $receivedStr")

                val sessionId = parseMessage(receivedStr)
                        ?.get("config")
                        ?.asJsonObject
                        ?.get("sessionId")
                        ?.asString
                        ?: throw IllegalStateException("Expected sessionId from WS_RECV_INIT message. Message: ${receivedStr}")

                session.tokenDictionary["SESSION"] = sessionId
                session.logger.debug("WS_RECV_INIT got SESSION: ${session.tokenDictionary["SESSION"]}")
            }
        }
    }

    class WS_RECV_BEGIN_UPLOAD(override val begin: Long,
                               override val lineNumber: Int,
                               val message: String) : Event(begin, lineNumber) {
        override fun handle(session: ShinySession, out: PrintWriter) {
            withLog(session, out) {
                val receivedStr = keepPolling(session.receiveQueue) {
                    session.logger.warn("WS_RECV_BEGIN_UPLOAD line ${lineNumber}: Haven't received message after $it seconds")
                }
                session.logger.debug("WS_RECV_BEGIN_UPLOAD received: $receivedStr")

                val jobId = parseMessage(receivedStr)
                        ?.get("response")
                        ?.asJsonObject
                        ?.get("value")
                        ?.asJsonObject
                        ?.get("jobId")
                        ?.asString
                        ?: error("Expected jobId from WS_RECV_BEGIN_UPLOAD message")

                session.tokenDictionary["UPLOAD_JOB_ID"] = jobId

                session.logger.debug("WS_RECV_BEGIN_UPLOAD got jobId: $jobId")
            }
        }
    }

    class WS_SEND(override val begin: Long,
                  override val lineNumber: Int,
                  val message: String) : Event(begin, lineNumber) {
        override fun sleepBefore(session: ShinySession) =
                begin - (session.lastEventEnded ?: begin)

        override fun handle(session: ShinySession, out: PrintWriter) {
            withLog(session, out) {
                val text = session.replaceTokens(message)
                session.webSocket!!.sendText(text)
                session.logger.debug("WS_SEND sent: $text")
            }
        }
    }

    class WS_CLOSE(override val begin: Long,
                   override val lineNumber: Int) : Event(begin, lineNumber) {
        override fun sleepBefore(session: ShinySession) =
                begin - (session.lastEventEnded ?: begin)

        override fun handle(session: ShinySession, out: PrintWriter) {
            withLog(session, out) {
                session.webSocket!!.disconnect()
                session.logger.debug("WS_CLOSE sent")
            }
        }
    }
}
