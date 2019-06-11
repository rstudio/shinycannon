package com.rstudio.shinycannon

import net.moznion.uribuildertiny.URIBuilderTiny
import org.apache.http.client.methods.HttpGet

enum class ServerType(val typeName: String) {
    RSC("RStudio Server Connect"),
    SSP("Shiny Server or Shiny Server Pro"),
    SAI("shinyapps.io"),
    SHN("R/Shiny")
}

fun typeFromName(typeName: String): ServerType {
    return when (typeName) {
        "RStudio Server Connect" -> ServerType.RSC
        "Shiny Server or Shiny Server Pro" -> ServerType.SSP
        "shinyapps.io" -> ServerType.SAI
        "R/Shiny" -> ServerType.SHN
        else -> error("Unknown server type name in recording: ${typeName}")
    }
}

fun servedBy(appUrl: String): ServerType {
    val url = URIBuilderTiny(appUrl)

    if (url.host.matches("^.*\\.shinyapps\\.io$".toRegex()))
        return ServerType.SAI

    val resp = slurp(HttpGet(appUrl))

    if (resp.headers.containsKey("SSP-XSRF")) {
        return ServerType.SSP
    } else if (resp.headers.containsKey("x-powered-by")) {
        val sspVals = setOf("Express", "Shiny Server", "Shiny Server Pro")
        if (sspVals.contains(resp.headers["x-powered-by"]))
            return ServerType.SSP
    } else if (resp.cookies.cookies.firstOrNull { it.name == "rscid" } != null) {
        return ServerType.RSC
    }

    val shinyJsNode = xpath(resp.body, "/html/head/script")
            .flatMap { List(it.attributes.length, { i -> it.attributes.item(i)}) }
            .filter { it.nodeName == "src" }
            .find { it.nodeValue.matches("^.*/shiny.min.js$".toRegex()) }

    if (shinyJsNode == null)
        error("Target URL ${appUrl} does not appear to be a Shiny application.")

    return ServerType.SHN
}