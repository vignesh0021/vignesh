package ai.opencode.mobile.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import ai.opencode.mobile.data.repository.ChatRepository
import ai.opencode.mobile.data.repository.SessionRepository
import ai.opencode.mobile.data.settings.SettingsRepository
import ai.opencode.mobile.domain.model.ChatMessage
import ai.opencode.mobile.ui.appContainer
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ChatHeader(val title: String, val modelId: String)

class ChatViewModel(
    private val sessionId: String,
    private val chatRepository: ChatRepository,
    private val sessionRepository: SessionRepository,
    settingsRepository: SettingsRepository,
) : ViewModel() {

    val messages: StateFlow<List<ChatMessage>> = chatRepository.observeMessages(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val header: StateFlow<ChatHeader> = settingsRepository.settings
        .map { ChatHeader(title = "Chat", modelId = it.modelId) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChatHeader("Chat", ""))

    private val _isSending = MutableStateFlow(false)
    val isSending: StateFlow<Boolean> = _isSending.asStateFlow()

    val errors = MutableSharedFlow<String>(extraBufferCapacity = 1)

    fun send(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || _isSending.value) return
        _isSending.value = true
        viewModelScope.launch {
            try {
                chatRepository.sendMessage(sessionId, trimmed)
                maybeAutoTitle(trimmed)
            } catch (e: ChatRepository.MissingApiKeyException) {
                errors.tryEmit(e.message ?: "No API key configured.")
            } catch (t: Throwable) {
                errors.tryEmit(t.message ?: "Failed to send message.")
            } finally {
                _isSending.value = false
            }
        }
    }

    /** Names an untitled-looking session after its first user prompt. */
    private suspend fun maybeAutoTitle(firstPrompt: String) {
        val session = sessionRepository.getSession(sessionId) ?: return
        if (session.title.startsWith("Session ")) {
            val title = firstPrompt.lineSequence().first().take(40)
            sessionRepository.rename(sessionId, title)
        }
    }

    companion object {
        fun provideFactory(sessionId: String): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                    val c = extras.appContainer()
                    @Suppress("UNCHECKED_CAST")
                    return ChatViewModel(
                        sessionId = sessionId,
                        chatRepository = c.chatRepository,
                        sessionRepository = c.sessionRepository,
                        settingsRepository = c.settingsRepository,
                    ) as T
                }
            }
    }
}
