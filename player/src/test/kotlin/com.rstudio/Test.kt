package org.jetbrains.kotlin.testJunit.test

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.rstudio.getTokens
import com.rstudio.replaceTokens
import com.rstudio.containSameTokens
import org.junit.Assert
import org.junit.Test


class Test {

    val testUrl = "foo${'$'}{LOL}bar${'\$'}{LMAO}"
    val allowedTokens: HashSet<String> = hashSetOf("LOL", "DUCK", "LMAO")
    val urlDictionary: HashMap<String, String> = hashMapOf(Pair("LOL", " funny! "), Pair("LMAO", " very funny!!! "))

    @Test
    fun testGetTokens() {
        val tokens = getTokens(testUrl)
        Assert.assertEquals(hashSetOf("LOL", "LMAO"), tokens)
    }

    @Test
    fun testTokenizeUrl() {
        val url = replaceTokens(testUrl, allowedTokens, urlDictionary)
        Assert.assertEquals("foo funny! bar very funny!!! ", url)
    }

    @Test
    fun testContainSameTokens() {
        val jp = JsonParser()
        val expectedStr = "{ \"name\":\"duck\", \"habitat\":\"water\", \"lifespan\":10 }"
        val receivedStr = "{ \"name\":\"goat\", \"habitat\":\"plains\", \"lifespan\":18 }"
        val expected: JsonObject = jp.parse(expectedStr) as JsonObject // or .asJsonObject ??
        val received: JsonObject = jp.parse(receivedStr) as JsonObject // or .asJsonObject ??
        Assert.assertTrue(containSameTokens(expected, received))
    }

}