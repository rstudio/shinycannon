package com.rstudio.shinycannon

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
    fun testParseMessage() {
        val m1 = """a["1#0|m|{\"config\":{\"sessionId\":\"a string inside\",\"user\":null}}"]"""
        val parsed = parseMessage(m1)
        Assert.assertEquals("a string inside", parsed?.get("config")?.asJsonObject?.get("sessionId")?.asString)

        val m2 = """a["1#0|m|{\"config\":{\"workerId\":\"139eab2\",\"sessionId\":\"abcdefg\",\"user\":null}}"]"""
        Assert.assertEquals("abcdefg", parseMessage(m2)?.get("config")?.asJsonObject?.get("sessionId")?.asString)
    }

    @Test
    fun testIgnore() {
        val ignorableMessages = listOf(
            """a["ACK 2"]""",
            """a["2#0|m|{\"busy\":\"busy\"}"]""",
            """a["3#0|m|{\"recalculating\":{\"name\":\"distPlot\",\"status\":\"recalculating\"}}"]""",
            """a["4#0|m|{\"recalculating\":{\"name\":\"distPlot\",\"status\":\"recalculated\"}}"]""",
            """a["5#0|m|{\"busy\":\"idle\"}"]""",
            """a["6#0|m|{\"errors\":[],\"values\":[],\"inputMessages\":[]}"]"""
        )

        ignorableMessages.forEach { message ->
            Assert.assertTrue(canIgnore(message))
        }

        val notIgnorableMessages = listOf(
            """a["0#0|m|{\"custom\":{\"credentials\":null,\"license\":{\"status\":\"activated\",\"evaluation\":false,\"expiration\":1534550400000}}}"]""",
            """a["1#0|m|{\"config\":{\"workerId\":\"139eab2067146f4b70e4391a9584f782467a5f00320f9897\",\"sessionId\":\"60a1c2cb407f38b89ae0bfe34bd9b12f\",\"user\":null}}"]"""
        )

        notIgnorableMessages.forEach { message ->
            Assert.assertFalse(canIgnore(message))
        }
    }


}