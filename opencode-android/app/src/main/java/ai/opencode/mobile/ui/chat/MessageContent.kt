package ai.opencode.mobile.ui.chat

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import ai.opencode.mobile.ui.theme.MonoTextStyle
import ai.opencode.mobile.util.MarkdownBlocks
import ai.opencode.mobile.util.SyntaxHighlighter

@Composable
fun MessageContent(markdown: String, modifier: Modifier = Modifier) {
    val blocks = remember(markdown) { MarkdownBlocks.parse(markdown) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlocks.Block.Text -> Text(
                    text = block.content,
                    style = MaterialTheme.typography.bodyMedium,
                )
                is MarkdownBlocks.Block.Code -> CodeBlock(block.language, block.content)
            }
        }
    }
}

@Composable
private fun CodeBlock(language: String?, code: String) {
    val clipboard = LocalClipboardManager.current
    Surface(
        color = Color(0xFF0D1117),
        contentColor = Color(0xFFE6EDF3),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 4.dp, top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = language?.ifBlank { "code" } ?: "code",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF8B949E),
                )
                IconButton(onClick = { clipboard.setText(AnnotatedString(code)) }) {
                    Icon(
                        Icons.Filled.ContentCopy,
                        contentDescription = "Copy code",
                        tint = Color(0xFF8B949E),
                    )
                }
            }
            Text(
                text = highlight(code),
                style = MonoTextStyle,
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp)
                    .padding(bottom = 12.dp),
            )
        }
    }
}

private val keywordColor = Color(0xFFFF7B72)
private val stringColor = Color(0xFFA5D6FF)
private val commentColor = Color(0xFF8B949E)
private val numberColor = Color(0xFFF2CC60)
private val plainColor = Color(0xFFE6EDF3)

private fun highlight(code: String): AnnotatedString = buildAnnotatedString {
    SyntaxHighlighter.tokenize(code).forEach { token ->
        val color = when (token.type) {
            SyntaxHighlighter.TokenType.KEYWORD -> keywordColor
            SyntaxHighlighter.TokenType.STRING -> stringColor
            SyntaxHighlighter.TokenType.COMMENT -> commentColor
            SyntaxHighlighter.TokenType.NUMBER -> numberColor
            SyntaxHighlighter.TokenType.PLAIN -> plainColor
        }
        withStyle(SpanStyle(color = color)) { append(token.text) }
    }
}
