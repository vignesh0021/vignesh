package ai.opencode.mobile.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---- Request bodies ----

@Serializable
data class WireChatMessageDto(val role: String, val content: String)

@Serializable
data class AnthropicRequestDto(
    val model: String,
    @SerialName("max_tokens") val maxTokens: Int,
    val system: String,
    val stream: Boolean = true,
    val messages: List<WireChatMessageDto>,
)

@Serializable
data class OpenAiRequestDto(
    val model: String,
    val stream: Boolean = true,
    val messages: List<WireChatMessageDto>,
)

// ---- Streaming delta payloads (parsed leniently) ----

@Serializable
data class AnthropicDeltaEvent(
    val type: String? = null,
    val delta: AnthropicDelta? = null,
)

@Serializable
data class AnthropicDelta(
    val type: String? = null,
    val text: String? = null,
)

@Serializable
data class OpenAiStreamChunk(val choices: List<OpenAiChoice> = emptyList())

@Serializable
data class OpenAiChoice(
    val delta: OpenAiDelta? = null,
    @SerialName("finish_reason") val finishReason: String? = null,
)

@Serializable
data class OpenAiDelta(val content: String? = null)

// ---- Error envelopes ----

@Serializable
data class ApiErrorEnvelope(val error: ApiErrorBody? = null)

@Serializable
data class ApiErrorBody(val message: String? = null, val type: String? = null)
