package ai.opencode.mobile.data.repository

import ai.opencode.mobile.data.local.MessageDao
import ai.opencode.mobile.data.local.SessionDao
import ai.opencode.mobile.data.local.toDomain
import ai.opencode.mobile.data.local.toEntity
import ai.opencode.mobile.data.remote.ChatClientFactory
import ai.opencode.mobile.data.remote.ChatRequest
import ai.opencode.mobile.data.remote.ChatStreamEvent
import ai.opencode.mobile.data.remote.WireMessage
import ai.opencode.mobile.data.settings.ApiKeyStore
import ai.opencode.mobile.data.settings.SettingsRepository
import ai.opencode.mobile.domain.model.ChatMessage
import ai.opencode.mobile.domain.model.MessageStatus
import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.util.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

class ChatRepository(
    private val messageDao: MessageDao,
    private val sessionDao: SessionDao,
    private val settingsRepository: SettingsRepository,
    private val apiKeyStore: ApiKeyStore,
    private val clientFactory: ChatClientFactory,
) {
    /** Raised when a send is attempted before an API key is configured. */
    class MissingApiKeyException : Exception("No API key configured for this provider.")

    fun observeMessages(sessionId: String): Flow<List<ChatMessage>> =
        messageDao.observeForSession(sessionId).map { list -> list.map { it.toDomain() } }

    /**
     * Persists the user's message, then streams the assistant reply, writing tokens into
     * the assistant row as they arrive. The UI observes the message table, so it updates
     * live. Throttled DB writes keep the token loop cheap.
     */
    suspend fun sendMessage(sessionId: String, userText: String) {
        val settings = settingsRepository.settings.first()
        val apiKey = apiKeyStore.getKey(settings.provider) ?: throw MissingApiKeyException()

        val userMessage = ChatMessage(
            sessionId = sessionId,
            role = Role.USER,
            content = userText,
            status = MessageStatus.COMPLETE,
        )
        messageDao.upsert(userMessage.toEntity())
        sessionDao.touch(sessionId, System.currentTimeMillis())

        val assistant = ChatMessage(
            sessionId = sessionId,
            role = Role.ASSISTANT,
            content = "",
            status = MessageStatus.STREAMING,
            model = settings.modelId,
        )
        messageDao.upsert(assistant.toEntity())

        val history = messageDao.listForSession(sessionId)
            .map { it.toDomain() }
            .filter { it.role == Role.USER || (it.role == Role.ASSISTANT && it.content.isNotBlank()) }
            .map { WireMessage(it.role, it.content) }

        val request = ChatRequest(
            model = settings.modelId,
            systemPrompt = settings.systemPrompt,
            messages = history,
            apiKey = apiKey,
            baseUrl = settings.baseUrl,
        )

        val builder = StringBuilder()
        var lastFlush = 0L
        var terminalWritten = false
        val client = clientFactory.create(settings.provider)

        try {
            client.streamChat(request).collect { event ->
                when (event) {
                    is ChatStreamEvent.Delta -> {
                        builder.append(event.text)
                        val now = System.currentTimeMillis()
                        if (now - lastFlush > FLUSH_INTERVAL_MS) {
                            messageDao.updateContent(
                                assistant.id, builder.toString(), MessageStatus.STREAMING.name
                            )
                            lastFlush = now
                        }
                    }
                    is ChatStreamEvent.Done -> {
                        val finalText = builder.toString().ifBlank { "(no response)" }
                        messageDao.updateContent(assistant.id, finalText, MessageStatus.COMPLETE.name)
                        terminalWritten = true
                    }
                    is ChatStreamEvent.Error -> {
                        Logger.w("Stream error: ${event.message}")
                        val text = if (builder.isBlank()) {
                            "⚠️ ${event.message}"
                        } else {
                            builder.toString() + "\n\n⚠️ ${event.message}"
                        }
                        messageDao.updateContent(assistant.id, text, MessageStatus.ERROR.name)
                        terminalWritten = true
                    }
                }
            }
            // Ensure a terminal state even if the provider closed without an explicit Done/Error.
            if (!terminalWritten) {
                messageDao.updateContent(
                    assistant.id,
                    builder.toString().ifBlank { "(no response)" },
                    MessageStatus.COMPLETE.name,
                )
            }
        } catch (t: Throwable) {
            Logger.e("sendMessage failed", t)
            messageDao.updateContent(
                assistant.id,
                (builder.toString() + "\n\n⚠️ ${t.message ?: "Unexpected error"}").trim(),
                MessageStatus.ERROR.name,
            )
        }
    }

    suspend fun deleteMessage(id: String) = messageDao.delete(id)

    companion object {
        private const val FLUSH_INTERVAL_MS = 60L
    }
}
