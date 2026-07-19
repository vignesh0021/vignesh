package ai.opencode.mobile.util

/**
 * A dependency-free, regex-based tokenizer used to colourize code blocks in chat and in
 * the file viewer. It is deliberately Android-free so it can be exercised by fast JVM unit
 * tests. The goal is "good enough" highlighting for the common languages a coding agent
 * emits, not a full grammar.
 */
object SyntaxHighlighter {

    enum class TokenType { KEYWORD, STRING, COMMENT, NUMBER, PLAIN }

    data class Token(val text: String, val type: TokenType)

    private val keywords = setOf(
        // Kotlin / Java / TS / JS / Python / Go superset — cheap and effective.
        "fun", "val", "var", "if", "else", "when", "for", "while", "return", "class",
        "object", "interface", "import", "package", "public", "private", "protected",
        "override", "suspend", "const", "let", "function", "def", "import", "from",
        "async", "await", "true", "false", "null", "nil", "None", "True", "False",
        "new", "this", "super", "try", "catch", "finally", "throw", "throws", "extends",
        "implements", "static", "void", "int", "String", "boolean", "func", "type",
        "struct", "enum", "sealed", "data", "companion", "in", "is", "as", "lateinit",
    )

    fun languageFromHint(hint: String?): String = (hint ?: "").trim().lowercase()

    fun tokenize(code: String): List<Token> {
        val tokens = mutableListOf<Token>()
        var i = 0
        val n = code.length
        val buffer = StringBuilder()

        fun flushPlain() {
            if (buffer.isNotEmpty()) {
                tokens += classifyWords(buffer.toString())
                buffer.setLength(0)
            }
        }

        while (i < n) {
            val c = code[i]
            when {
                // Line comments: // and #
                (c == '/' && i + 1 < n && code[i + 1] == '/') || c == '#' -> {
                    flushPlain()
                    val end = code.indexOf('\n', i).let { if (it == -1) n else it }
                    tokens += Token(code.substring(i, end), TokenType.COMMENT)
                    i = end
                }
                // Block comments
                c == '/' && i + 1 < n && code[i + 1] == '*' -> {
                    flushPlain()
                    val close = code.indexOf("*/", i + 2)
                    val end = if (close == -1) n else close + 2
                    tokens += Token(code.substring(i, end), TokenType.COMMENT)
                    i = end
                }
                // Strings (single, double, backtick)
                c == '"' || c == '\'' || c == '`' -> {
                    flushPlain()
                    val end = findStringEnd(code, i, c)
                    tokens += Token(code.substring(i, end), TokenType.STRING)
                    i = end
                }
                else -> {
                    buffer.append(c)
                    i++
                }
            }
        }
        flushPlain()
        return tokens
    }

    private fun findStringEnd(code: String, start: Int, quote: Char): Int {
        var j = start + 1
        while (j < code.length) {
            val ch = code[j]
            if (ch == '\\') {
                j += 2
                continue
            }
            if (ch == quote) return j + 1
            j++
        }
        return code.length
    }

    private fun classifyWords(chunk: String): List<Token> {
        val result = mutableListOf<Token>()
        val matcher = Regex("[A-Za-z_][A-Za-z0-9_]*|\\d+(?:\\.\\d+)?|[^A-Za-z0-9_]+")
        for (m in matcher.findAll(chunk)) {
            val text = m.value
            val type = when {
                text.first().isLetter() || text.first() == '_' ->
                    if (text in keywords) TokenType.KEYWORD else TokenType.PLAIN
                text.first().isDigit() -> TokenType.NUMBER
                else -> TokenType.PLAIN
            }
            result += Token(text, type)
        }
        return result
    }
}
