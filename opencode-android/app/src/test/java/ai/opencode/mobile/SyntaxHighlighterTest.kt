package ai.opencode.mobile

import ai.opencode.mobile.util.SyntaxHighlighter
import ai.opencode.mobile.util.SyntaxHighlighter.TokenType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyntaxHighlighterTest {

    @Test
    fun `reconstructs original source exactly`() {
        val code = "fun add(a: Int, b: Int) = a + b // sum"
        val rebuilt = SyntaxHighlighter.tokenize(code).joinToString("") { it.text }
        assertEquals(code, rebuilt)
    }

    @Test
    fun `keywords are classified`() {
        val tokens = SyntaxHighlighter.tokenize("val x = 1")
        assertTrue(tokens.any { it.text == "val" && it.type == TokenType.KEYWORD })
    }

    @Test
    fun `strings are captured as a single token`() {
        val tokens = SyntaxHighlighter.tokenize("""val s = "hello world"""")
        val stringToken = tokens.firstOrNull { it.type == TokenType.STRING }
        assertEquals("\"hello world\"", stringToken?.text)
    }

    @Test
    fun `line comments extend to end of line`() {
        val tokens = SyntaxHighlighter.tokenize("code // trailing comment")
        assertTrue(tokens.any { it.type == TokenType.COMMENT && it.text.contains("trailing") })
    }

    @Test
    fun `numbers are classified`() {
        val tokens = SyntaxHighlighter.tokenize("x = 42")
        assertTrue(tokens.any { it.text == "42" && it.type == TokenType.NUMBER })
    }

    @Test
    fun `unterminated string does not throw and consumes rest`() {
        val tokens = SyntaxHighlighter.tokenize("val s = \"oops")
        assertTrue(tokens.any { it.type == TokenType.STRING })
    }
}
