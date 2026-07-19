package ai.opencode.mobile

import ai.opencode.mobile.util.MarkdownBlocks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownBlocksTest {

    @Test
    fun `splits text and fenced code`() {
        val md = """
            Here is some code:
            ```kotlin
            fun main() {}
            ```
            Done.
        """.trimIndent()

        val blocks = MarkdownBlocks.parse(md)
        assertEquals(3, blocks.size)
        assertTrue(blocks[0] is MarkdownBlocks.Block.Text)
        val code = blocks[1] as MarkdownBlocks.Block.Code
        assertEquals("kotlin", code.language)
        assertEquals("fun main() {}", code.content)
        assertTrue(blocks[2] is MarkdownBlocks.Block.Text)
    }

    @Test
    fun `plain text produces single text block`() {
        val blocks = MarkdownBlocks.parse("just a sentence")
        assertEquals(1, blocks.size)
        assertTrue(blocks[0] is MarkdownBlocks.Block.Text)
    }

    @Test
    fun `code fence without language is allowed`() {
        val blocks = MarkdownBlocks.parse("```\nplain\n```")
        val code = blocks.filterIsInstance<MarkdownBlocks.Block.Code>().first()
        assertEquals(null, code.language)
        assertEquals("plain", code.content)
    }

    @Test
    fun `unterminated fence still yields a code block`() {
        val blocks = MarkdownBlocks.parse("```js\nconsole.log(1)")
        assertTrue(blocks.any { it is MarkdownBlocks.Block.Code })
    }
}
