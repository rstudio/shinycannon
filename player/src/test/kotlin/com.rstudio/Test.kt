package org.jetbrains.kotlin.testJunit.test

import com.rstudio.getTokens
import org.junit.Assert
import org.junit.Test


class Test {

    @Test
    fun testGettingTokens() {
        val testUrl = "foo${'$'}{LOL}bar${'\$'}{LMAO}"
        val tokens = getTokens(testUrl)
        Assert.assertEquals(hashSetOf("LOL", "LMAO"), tokens)
    }

}