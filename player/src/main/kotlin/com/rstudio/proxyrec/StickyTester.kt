package com.rstudio.proxyrec

import com.google.gson.Gson
import org.apache.http.client.config.CookieSpecs
import org.apache.http.client.config.RequestConfig
import org.apache.http.client.methods.HttpGet
import org.apache.http.impl.client.BasicCookieStore
import org.apache.http.impl.client.HttpClientBuilder
import org.apache.log4j.*
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

fun get(cookieStore: BasicCookieStore, url: String): Pair<Int, String> {
    val cfg = RequestConfig.custom()
            .setCookieSpec(CookieSpecs.STANDARD)
            .build()
    val client = HttpClientBuilder
            .create()
            .setDefaultCookieStore(cookieStore)
            .setDefaultRequestConfig(cfg)
            .build()
    val get = HttpGet(url)
    client.execute(get).use { response ->
        val baos = ByteArrayOutputStream()
        response.entity.content.copyTo(baos)
        val body = String(baos.toByteArray())
        return Pair(response.statusLine.statusCode, body)
    }
}

val appUrl = "http://shinyloadtest-sticky.rstudioservices.com/content/5/"

fun main(args: Array<String>) {

    val ca = ConsoleAppender()
    ca.layout = PatternLayout("%5p [%t] %d (%F:%L) - %m%n")
    ca.threshold = Level.ERROR
    ca.activateOptions()
    Logger.getRootLogger().addAppender(ca)

    val seen: ConcurrentHashMap<String, Int> = ConcurrentHashMap()
    val cookieStore = BasicCookieStore()

    for(i in 1..10) {
        val response = get(cookieStore, appUrl)
        val page = response.second
        val re = """.*<div>(i-[0-9a-z]+)<.*""".toRegex(options = setOf(RegexOption.MULTILINE, RegexOption.DOT_MATCHES_ALL))
        val match = re.matchEntire(page)
        val instanceId = match?.groupValues?.getOrNull(1)!!
        println(match?.groupValues?.getOrNull(1))
        seen.compute(instanceId, { k, v ->
            if (v == null) 1 else v+1
        })
    }

    println(Gson().toJson(seen))
}