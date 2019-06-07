package com.rstudio.shinycannon

import net.moznion.uribuildertiny.URIBuilderTiny

enum class ServerType(val type: String) {
    RSC("RStudio Server Connect"),
    SSP("Shiny Server or Shiny Server Pro"),
    SAI("shinyapps.io"),
    SHN("R/Shiny")
}

fun servedBy(appUrl: String): ServerType {
    val url = URIBuilderTiny(appUrl)

    if (url.host.matches("^.*\\.shinyapps\\.io$".toRegex()))
        return ServerType.SAI

    return ServerType.SHN
    // TODO remaining server type tests
}