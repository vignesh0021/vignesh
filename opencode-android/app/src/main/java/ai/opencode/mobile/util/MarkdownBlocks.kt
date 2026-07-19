package ai.opencode.mobile.util

/**
 * Splits assistant markdown into an ordered list of blocks so the UI can render fenced
 * code blocks with syntax highlighting and copy buttons, and everything else as text.
 * Kept Android-free for unit testing.
 */
object MarkdownBlocks {

    sealed interface Block {
        data class Text(val content: String) : Block
        data class Code(val language: String?, val content: String) : Block
    }

    private val fence = Regex("^```([A-Za-z0-9_+-]*)\\s*$")

    fun parse(markdown: String): List<Block> {
        val blocks = mutableListOf<Block>()
        val lines = markdown.split("\n")
        val textBuffer = StringBuilder()
        var i = 0

        fun flushText() {
            val text = textBuffer.toString().trim('\n')
            if (text.isNotEmpty()) blocks += Block.Text(text)
            textBuffer.setLength(0)
        }

        while (i < lines.size) {
            val open = fence.find(lines[i].trim())
            if (open != null) {
                flushText()
                val lang = open.groupValues[1].ifBlank { null }
                val codeBuffer = StringBuilder()
                i++
                while (i < lines.size && lines[i].trim() != "```") {
                    codeBuffer.append(lines[i]).append('\n')
                    i++
                }
                // skip the closing fence if present
                if (i < lines.size) i++
                blocks += Block.Code(lang, codeBuffer.toString().trimEnd('\n'))
            } else {
                textBuffer.append(lines[i]).append('\n')
                i++
            }
        }
        flushText()
        return blocks
    }
}
