package ai.opencode.mobile.data.remote

import ai.opencode.mobile.domain.model.Role
import kotlinx.coroutines.flow.Flow

/** A single turn passed to the model. */
data class WireMessage(val role: Role, val content: String)

data class ChatRequest(
    val model: String,
    val systemPrompt: String,
    val messages: List<WireMessage>,
    val apiKey: String,
    val baseUrl: String,
    val maxTokens: Int = 4096,
)

/** Streaming events emitted while the assistant is responding. */
sealed interface ChatStreamEvent {
    data class Delta(val text: String) : ChatStreamEvent
    data object Done : ChatStreamEvent
    data class Error(val message: String) : ChatStreamEvent
}

/** Provider-agnostic streaming chat contract, mirroring opencode's pluggable providers. */
interface ChatClient {
    fun streamChat(request: ChatRequest): Flow<ChatStreamEvent>
}
