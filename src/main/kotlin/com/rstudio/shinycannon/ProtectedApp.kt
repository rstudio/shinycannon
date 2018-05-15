package com.rstudio.shinycannon

import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.client.config.CookieSpecs
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.entity.UrlEncodedFormEntity
import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpPost
import org.apache.http.client.methods.HttpUriRequest
import org.apache.http.cookie.Cookie
import org.apache.http.impl.client.BasicCookieStore
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.http.message.BasicNameValuePair
import org.w3c.dom.NamedNodeMap
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import org.xml.sax.InputSource
import java.io.ByteArrayOutputStream
import java.io.StringReader
import java.net.URL
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.xpath.XPathConstants
import javax.xml.xpath.XPathFactory

data class HttpResponse(val statusCode: Int,
                        val headers: Map<String, String>,
                        val cookies: BasicCookieStore,
                        val body: String)

fun slurp(req: HttpUriRequest): HttpResponse {
    val cookies = BasicCookieStore()
    val cfg = RequestConfig.custom()
            .setCookieSpec(CookieSpecs.STANDARD)
            .build()
    val client = HttpClientBuilder
            .create()
            .setDefaultCookieStore(cookies)
            .setDefaultRequestConfig(cfg)
            .build()
    client.execute(req).use { response ->
        return HttpResponse(response.statusLine.statusCode,
                response.allHeaders.map { Pair(it.name, it.value) }.toMap(),
                cookies,
                ByteArrayOutputStream().let { baos ->
                    response.entity.content.copyTo(baos)
                    baos.toString()
                })
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

enum class AppServer { RSC, SSP, UNKNOWN }

fun isProtected(appUrl: String): Boolean {
    return setOf(403, 404).contains(slurp(HttpGet(appUrl)).statusCode)
}

fun servedBy(resp: HttpResponse): AppServer {
    val headers = resp.headers
    return when {
    // TODO figure out why SSP-XSRF not served by 1.5.8.960
        headers["X-Powered-By"] == "Express" -> AppServer.SSP
    // SSP doesn't report this as of this writing, but probably will soon
    // https://github.com/rstudio/shiny-server/pull/361
        headers["X-Powered-By"] == "Shiny Server Pro" -> AppServer.SSP
        headers.containsKey("rscid") -> AppServer.RSC
        else -> AppServer.UNKNOWN
    }
}

// Returns a Map of hidden inputs that must be posted along with
// username and password. The map is empty except for SSP.
fun getInputs(resp: HttpResponse, server: AppServer): Map<String, String> {
    return when (server) {
        AppServer.SSP -> {
            xpath(resp.body, "//input[@type='hidden']")
                    .map { it.attributes }
                    .map { attrs -> Pair(attrs["name"], attrs["value"]) }
                    .toMap()
        }
        else -> mapOf()
    }
}

fun loginUrlFor(appUrl: String, server: AppServer): String {
    return when (server) {
        AppServer.RSC -> URL(appUrl).let { url ->
            URIBuilderTiny()
                    .setScheme(url.protocol)
                    .setHost(url.host)
                    .setPort(url.port)
                    .appendPaths("__login__")
                    .build()
                    .toString()
        }
        AppServer.SSP -> URIBuilderTiny(appUrl)
                .appendPaths("__login__")
                .build()
                .toString()
        else -> error("Don't know how to construct login URL for $server")
    }
}

fun BasicCookieStore.shallowCopy(): BasicCookieStore {
    return BasicCookieStore().also {
        this.cookies.forEach { cookie -> it.addCookie(cookie) }
    }
}

// Stateful container that encapsulates requesting the auth form, extracting
// necessary data from that response, and incorporating that data into a request
// that should culminate with an auth cookie (postLogin method).
class ProtectedApp(val appUrl: String) {
    private val resp = slurp(HttpGet(appUrl))
    val server = servedBy(resp)
    val inputs = getInputs(resp, server)
    val loginUrl = loginUrlFor(appUrl, server)

    fun postLogin(username: String, password: String): Cookie {
        val cookies = resp.cookies.shallowCopy()
        val cfg = RequestConfig.custom()
                .setCookieSpec(CookieSpecs.STANDARD)
                .build()
        val client = HttpClientBuilder
                .create()
                .setDefaultCookieStore(cookies)
                .setDefaultRequestConfig(cfg)
                .build()
        val post = HttpPost(loginUrl)
        val formFields = mapOf(
                "username" to username,
                "password" to password
        ) + inputs
        post.entity = formFields.map { entry ->
            BasicNameValuePair(entry.key, entry.value)
        }.let { pairs -> UrlEncodedFormEntity(pairs) }
        client.execute(post).use { _ ->
            return when (server) {
                AppServer.SSP -> cookies.cookies.firstOrNull { it.name == "session_state" }
                AppServer.RSC -> cookies.cookies.firstOrNull { it.name == "rsconnect" }
                else -> error("Don't know how to post login form to $server")
            } ?: error("Couldn't determine auth cookie for $server")
        }
    }
}