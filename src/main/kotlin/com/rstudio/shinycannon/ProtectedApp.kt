package com.rstudio.shinycannon

import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.Header
import org.apache.http.HttpEntity
import org.apache.http.client.config.CookieSpecs
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.entity.UrlEncodedFormEntity
import org.apache.http.client.methods.HttpEntityEnclosingRequestBase
import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpPost
import org.apache.http.client.methods.HttpUriRequest
import org.apache.http.entity.StringEntity
import org.apache.http.impl.client.BasicCookieStore
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.http.message.BasicNameValuePair
import org.apache.logging.log4j.Logger
import org.w3c.dom.NamedNodeMap
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import org.xml.sax.InputSource
import java.io.ByteArrayOutputStream
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.xpath.XPathConstants
import javax.xml.xpath.XPathFactory

class HttpResponse(val statusCode: Int,
                   val headers: Map<String, String>,
                   val cookieStore: BasicCookieStore,
                   val body: String) {
    fun getCookie(name: String) = this.cookieStore.cookies.firstOrNull { it.name == name }
    fun hasCookie(name: String) = this.getCookie(name) != null
    fun getHeader(name: String) = this.headers.get(name.toLowerCase())
    fun hasHeader(name: String) = this.headers.containsKey(name.toLowerCase())
    companion object {
        fun from(response: org.apache.http.HttpResponse, cookies: BasicCookieStore): HttpResponse {
            return HttpResponse(
                    response.statusLine.statusCode,
                    response.allHeaders.map { Pair(it.name.toLowerCase(), it.value) }.toMap(),
                    cookies,
                    ByteArrayOutputStream().let {
                        response.entity.content.copyTo(it)
                        it.toString()
                    }

            )
        }
    }
}

fun slurp(req: HttpUriRequest, cookies: BasicCookieStore = BasicCookieStore()): HttpResponse {
    val cfg = RequestConfig.custom()
            .setCookieSpec(CookieSpecs.STANDARD)
            .build()
    val client = HttpClientBuilder
            .create()
            .setDefaultCookieStore(cookies)
            .setDefaultRequestConfig(cfg)
            .build()
    client.execute(req).use { response ->
        return HttpResponse.from(response, cookies)
    }
}

fun xpath(docString: String, query: String): Array<Node> {
    val dbf = DocumentBuilderFactory.newInstance()
    val db = dbf.newDocumentBuilder()
    val doc = db.parse(InputSource(StringReader(docString)))
    val xpathFactory = XPathFactory.newInstance()
    val xpath = xpathFactory.newXPath()
    val nodes = xpath.evaluate(query, doc, XPathConstants.NODESET) as NodeList
    return Array(nodes.length, { i -> nodes.item(i) })
}

// Helper function (overrides []) for getting keys from a NamedNodeList, a weird
// XML collection type produced by the XPath API.
operator fun NamedNodeMap.get(itemName: String): String = this.getNamedItem(itemName).nodeValue

fun isProtected(appUrl: String, headers: MutableList<Header> = mutableListOf()): Boolean {
    return setOf(403, 404).contains(slurp(HttpGet(appUrl).addHeaders(headers)).statusCode)
}

// Returns a Map of hidden inputs that must be posted along with
// username and password. The map is empty except for SSP.
fun getInputs(resp: HttpResponse, server: ServerType): Map<String, String> {
    return when (server) {
        ServerType.SSP -> {
            xpath(resp.body, "//input[@type='hidden']")
                    .map { it.attributes }
                    .map { attrs -> Pair(attrs["name"], attrs["value"]) }
                    .toMap()
        }
        else -> mapOf()
    }
}

fun loginUrlFor(appUrl: String, server: ServerType): String {
    return when (server) {
        ServerType.SSP, ServerType.RSC -> URIBuilderTiny(appUrl)
                .appendPaths("__login__")
                .build()
                .toString()
        else -> error("Don't know how to construct login URL for server type '${server.typeName}")
    }
}

data class AuthContext(val cookies: BasicCookieStore,
                       val inputs: Map<String, String>,
                       val loginUrl: String)

fun getCookies(request: HttpEntityEnclosingRequestBase,
               cookies: BasicCookieStore = BasicCookieStore(),
               entity: HttpEntity): BasicCookieStore {

    val cfg = RequestConfig.custom()
            .setCookieSpec(CookieSpecs.STANDARD)
            .build()
    val client = HttpClientBuilder
            .create()
            .setDefaultCookieStore(cookies)
            .setDefaultRequestConfig(cfg)
            .build()
    request.entity = entity
    client.execute(request).use {
        check(setOf(200, 302).contains(it.statusLine.statusCode), {
            "Received status ${it.statusLine.statusCode} attempting to get cookies"
        })
        return cookies
    }
}

// ping an RSC app and retrieve the cookies (load balancer, etc)
// having a connect api key is not enough info for routing traffic
fun getCookiesGet(request: HttpGet, 
                  cookies: BasicCookieStore = BasicCookieStore()): BasicCookieStore {
    val cfg = RequestConfig.custom()
        .setCookieSpec(CookieSpecs.STANDARD)
        .build()
    val client = HttpClientBuilder
        .create()
        .setDefaultCookieStore(cookies)
        .setDefaultRequestConfig(cfg)
        .build()

    client.execute(request).use {
        check(setOf(200, 302).contains(it.statusLine.statusCode), {
            "Received status ${it.statusLine.statusCode} attempting to get cookies"
        })
        return cookies
    }
}

fun loginRSC(context: AuthContext, username: String, password: String): BasicCookieStore {

    val entity = com.google.gson.JsonObject().also {
        it.addProperty("username", username)
        it.addProperty("password", password)
    }.let { StringEntity(it.toString()) }

    val post = HttpPost(context.loginUrl)

    return getCookies(post, context.cookies, entity).apply {
        val authCookie = cookies.firstOrNull { it.name == "rsconnect" }
        checkNotNull(authCookie, { "Couldn't find RSC auth cookie" })
    }
}

fun loginSSP(context: AuthContext, username: String, password: String): BasicCookieStore {

    val fields = mapOf(
            "username" to username,
            "password" to password
    ) + context.inputs

    val entity = fields
            .map { BasicNameValuePair(it.key, it.value) }
            .let { UrlEncodedFormEntity(it) }

    val post = HttpPost(context.loginUrl)

    return getCookies(post, context.cookies, entity).apply {
        val authCookie = cookies.firstOrNull { it.name == "session_state" }
        checkNotNull(authCookie, { "Couldn't find SSP auth cookie" })
    }
}

fun postLogin(appUrl: String,
              username: String,
              password: String,
              cookies: BasicCookieStore,
              logger: Logger,
              headers: MutableList<Header> = mutableListOf()): BasicCookieStore {

    val resp = slurp(HttpGet(appUrl).addHeaders(headers), cookies = cookies)
    val server = servedBy(appUrl, logger)
    val inputs = getInputs(resp, server)
    val loginUrl = loginUrlFor(appUrl, server)
    val context = AuthContext(cookies, inputs, loginUrl)

    return when(server) {
        ServerType.RSC -> loginRSC(context, username, password)
        ServerType.SSP -> loginSSP(context, username, password)
        else -> error("Can't log in to server type: '${server.typeName}'")
    }
}

fun getConnectCookies(appUrl: String,
              cookies: BasicCookieStore,
              headers: MutableList<Header> = mutableListOf()): BasicCookieStore {

    val get = HttpGet(appUrl).addHeaders(headers)

    return getCookiesGet(get, cookies)
}
