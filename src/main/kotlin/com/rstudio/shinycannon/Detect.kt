package com.rstudio.shinycannon

import net.moznion.uribuildertiny.URIBuilderTiny

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
        else -> error("Unknown server type name: ${typeName}")
    }
}

fun servedBy(appUrl: String): ServerType {
    val url = URIBuilderTiny(appUrl)

    if (url.host.matches("^.*\\.shinyapps\\.io$".toRegex()))
        return ServerType.SAI

    return ServerType.SHN
    // TODO remaining server type tests
}