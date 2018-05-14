package com.rstudio.shinycannon

import org.apache.http.client.methods.HttpGet
import org.apache.http.client.methods.HttpUriRequest
import org.apache.http.impl.client.HttpClientBuilder
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import org.xml.sax.InputSource
import java.io.ByteArrayOutputStream
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.xpath.XPathConstants
import javax.xml.xpath.XPathFactory

data class HttpResponse(val statusCode: Int,
                        val headers: Map<String, String>,
                        val body: String)

fun slurp(req: HttpUriRequest): HttpResponse {
    HttpClientBuilder.create().build().execute(req).use { response ->
        return HttpResponse(response.statusLine.statusCode,
                response.allHeaders.fold(mapOf(), { m, h ->
                    m + Pair(h.name, h.value)
                }),
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

enum class AppServer { RSC, SSP, UNKNOWN }

class App(val appUrl: String) {
    companion object {
        fun isProtected(appUrl: String): Boolean {
            return setOf(403, 404).contains(slurp(HttpGet(appUrl)).statusCode)
        }

        fun servedBy(resp: HttpResponse): AppServer {
            val headers = resp.headers
            return when {
                // TODO figure out why SSP-XSRF not served by 1.5.8.960
                headers["X-Powered-By"] == "Express" -> AppServer.SSP
                headers.containsKey("rscid") -> AppServer.RSC
                else -> AppServer.UNKNOWN
            }
        }

        fun getInputs(resp: HttpResponse, server: AppServer): Map<String, String> {
            return when (server) {
                AppServer.SSP -> {
                    xpath(resp.body, "//input[@type='hidden']").fold(
                            mapOf(),
                            { xs, y ->
                                xs + Pair(y.attributes.getNamedItem("name").nodeValue,
                                        y.attributes.getNamedItem("value").nodeValue)
                            }
                    )
                }
                else -> mapOf()
            }
        }
    }

    val resp = slurp(HttpGet(appUrl))
    val server = servedBy(resp)
    val inputs = getInputs(resp, server)
}

fun main(args: Array<String>) {
    val app = App("http://localhost:3838/")
    println(app.inputs)
}