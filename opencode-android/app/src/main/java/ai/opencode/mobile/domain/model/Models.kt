package ai.opencode.mobile.domain.model

import java.util.UUID

/** Supported AI backends. opencode.ai is provider-agnostic; we mirror that here. */
enum class ProviderType(val displayName: String, val defaultBaseUrl: String) {
    ANTHROPIC("Anthropic", "https://api.anthropic.com"),
    OPENAI("OpenAI", "https://api.openai.com"),
    OPENAI_COMPATIBLE("OpenAI-compatible", "https://api.openai.com");

    companion object {
        fun fromName(name: String?): ProviderType =
            entries.firstOrNull { it.name == name } ?: ANTHROPIC
    }
}

/** A selectable model exposed by a provider. */
data class AiModel(
    val id: String,
    val label: String,
    val provider: ProviderType,
)

/** The role of a chat participant, mirroring opencode's message model. */
enum class Role { USER, ASSISTANT, SYSTEM }

/** Delivery/streaming state of an assistant message. */
enum class MessageStatus { PENDING, STREAMING, COMPLETE, ERROR }

data class Session(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val provider: ProviderType,
    val modelId: String,
    val projectPath: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val sessionId: String,
    val role: Role,
    val content: String,
    val status: MessageStatus = MessageStatus.COMPLETE,
    val model: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

/** Catalog of the most common models, used to seed the model picker. */
object ModelCatalog {
    val models: List<AiModel> = listOf(
        AiModel("claude-opus-4-8", "Claude Opus 4.8", ProviderType.ANTHROPIC),
        AiModel("claude-sonnet-5", "Claude Sonnet 5", ProviderType.ANTHROPIC),
        AiModel("claude-haiku-4-5-20251001", "Claude Haiku 4.5", ProviderType.ANTHROPIC),
        AiModel("gpt-4o", "GPT-4o", ProviderType.OPENAI),
        AiModel("gpt-4o-mini", "GPT-4o mini", ProviderType.OPENAI),
        AiModel("o4-mini", "o4-mini", ProviderType.OPENAI),
    )

    fun forProvider(provider: ProviderType): List<AiModel> = when (provider) {
        ProviderType.ANTHROPIC -> models.filter { it.provider == ProviderType.ANTHROPIC }
        ProviderType.OPENAI, ProviderType.OPENAI_COMPATIBLE ->
            models.filter { it.provider == ProviderType.OPENAI }
    }

    fun defaultModel(provider: ProviderType): String =
        forProvider(provider).firstOrNull()?.id
            ?: models.first().id
}
