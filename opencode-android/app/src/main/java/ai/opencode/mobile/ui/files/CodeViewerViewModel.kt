package ai.opencode.mobile.ui.files

import android.net.Uri
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import ai.opencode.mobile.data.repository.WorkspaceRepository
import ai.opencode.mobile.ui.appContainer
import ai.opencode.mobile.util.SyntaxHighlighter
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CodeViewerState(
    val content: String = "",
    val editing: Boolean = false,
    val loading: Boolean = true,
)

class CodeViewerViewModel(
    private val path: String,
    private val workspace: WorkspaceRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(CodeViewerState())
    val state: StateFlow<CodeViewerState> = _state.asStateFlow()

    val messages = MutableSharedFlow<String>(extraBufferCapacity = 1)

    init {
        viewModelScope.launch {
            val text = workspace.readText(path)
            _state.value = CodeViewerState(content = text, loading = false)
        }
    }

    fun onContentChange(text: String) {
        _state.value = _state.value.copy(content = text)
    }

    fun toggleEdit() {
        _state.value = _state.value.copy(editing = !_state.value.editing)
    }

    fun save() {
        viewModelScope.launch {
            val ok = workspace.writeText(path, _state.value.content)
            messages.tryEmit(if (ok) "Saved" else "Save failed")
        }
    }

    companion object {
        fun provideFactory(encodedPath: String): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                    val decoded = Uri.decode(encodedPath)
                    @Suppress("UNCHECKED_CAST")
                    return CodeViewerViewModel(decoded, extras.appContainer().workspaceRepository) as T
                }
            }
    }
}

private val keywordColor = Color(0xFFFF7B72)
private val stringColor = Color(0xFF79C0FF)
private val commentColor = Color(0xFF8B949E)
private val numberColor = Color(0xFFF2CC60)

fun highlightViewer(code: String): AnnotatedString = buildAnnotatedString {
    SyntaxHighlighter.tokenize(code).forEach { token ->
        when (token.type) {
            SyntaxHighlighter.TokenType.KEYWORD ->
                withStyle(SpanStyle(color = keywordColor)) { append(token.text) }
            SyntaxHighlighter.TokenType.STRING ->
                withStyle(SpanStyle(color = stringColor)) { append(token.text) }
            SyntaxHighlighter.TokenType.COMMENT ->
                withStyle(SpanStyle(color = commentColor)) { append(token.text) }
            SyntaxHighlighter.TokenType.NUMBER ->
                withStyle(SpanStyle(color = numberColor)) { append(token.text) }
            SyntaxHighlighter.TokenType.PLAIN -> append(token.text)
        }
    }
}
