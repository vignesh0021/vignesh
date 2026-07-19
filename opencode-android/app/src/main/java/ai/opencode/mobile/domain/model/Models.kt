package ai.opencode.mobile.domain.model

import java.util.UUID

/**
 * Supported AI backends. opencode.ai is provider-agnostic and ships with access to free
 * models; we mirror that by defaulting to OpenRouter, which exposes many genuinely free
 * models behind a free API key, alongside Groq's free tier and the usual paid providers.
 * All OpenAI-compatible providers share a single streaming client.
 */
enum class ProviderType(val displayName: String, val defaultBaseUrl: String, val keyUrl: String?) {
    OPENROUTER("OpenRouter (free)", "https://openrouter.ai/api", "https://openrouter.ai/keys"),
    GROQ("Groq (free)", "https://api.groq.com/openai", "https://console.groq.com/keys"),
    ANTHROPIC("Anthropic", "https://api.anthropic.com", "https://console.anthropic.com/settings/keys"),
    OPENAI("OpenAI", "https://api.openai.com", "https://platform.openai.com/api-keys"),
    OPENAI_COMPATIBLE("OpenAI-compatible", "https://api.openai.com", null);

    val isOpenAiCompatible: Boolean
        get() = this != ANTHROPIC

    companion object {
        fun fromName(name: String?): ProviderType =
            entries.firstOrNull { it.name == name } ?: OPENROUTER
    }
}

/** A selectable model exposed by a provider. */
data class AiModel(
    val id: String,
    val label: String,
    val provider: ProviderType,
    val free: Boolean = false,
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

/**
 * Catalog used to seed the model picker. OpenRouter and Groq models marked [AiModel.free]
 * cost nothing to run (a free API key is still required). Provider-hosted model ids change
 * over time; the picker also accepts any custom id the user types in Settings.
 */
object ModelCatalog {
    val models: List<AiModel> = listOf(
        // --- OpenRouter: free models (require a free OpenRouter key) ---
        AiModel("deepseek/deepseek-r1:free", "DeepSeek R1 · free", ProviderType.OPENROUTER, free = true),
        AiModel("deepseek/deepseek-chat-v3-0324:free", "DeepSeek V3 · free", ProviderType.OPENROUTER, free = true),
        AiModel("qwen/qwen-2.5-coder-32b-instruct:free", "Qwen2.5 Coder 32B · free", ProviderType.OPENROUTER, free = true),
        AiModel("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B · free", ProviderType.OPENROUTER, free = true),
        AiModel("google/gemini-2.0-flash-exp:free", "Gemini 2.0 Flash · free", ProviderType.OPENROUTER, free = true),
        AiModel("mistralai/mistral-small-3.1-24b-instruct:free", "Mistral Small 3.1 · free", ProviderType.OPENROUTER, free = true),
        AiModel("mistralai/mistral-7b-instruct:free", "Mistral 7B · free", ProviderType.OPENROUTER, free = true),
        AiModel("google/gemma-2-9b-it:free", "Gemma 2 9B · free", ProviderType.OPENROUTER, free = true),

        // --- Groq: free tier (require a free Groq key) ---
        AiModel("llama-3.3-70b-versatile", "Llama 3.3 70B · free", ProviderType.GROQ, free = true),
        AiModel("llama-3.1-8b-instant", "Llama 3.1 8B (fast) · free", ProviderType.GROQ, free = true),
        AiModel("deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill 70B · free", ProviderType.GROQ, free = true),

        // --- Anthropic ---
        AiModel("claude-opus-4-8", "Claude Opus 4.8", ProviderType.ANTHROPIC),
        AiModel("claude-sonnet-5", "Claude Sonnet 5", ProviderType.ANTHROPIC),
        AiModel("claude-haiku-4-5-20251001", "Claude Haiku 4.5", ProviderType.ANTHROPIC),

        // --- OpenAI ---
        AiModel("gpt-4o", "GPT-4o", ProviderType.OPENAI),
        AiModel("gpt-4o-mini", "GPT-4o mini", ProviderType.OPENAI),
        AiModel("o4-mini", "o4-mini", ProviderType.OPENAI),
    )

    fun forProvider(provider: ProviderType): List<AiModel> = when (provider) {
        ProviderType.OPENAI_COMPATIBLE -> models.filter { it.provider == ProviderType.OPENAI }
        else -> models.filter { it.provider == provider }
    }

    fun defaultModel(provider: ProviderType): String =
        forProvider(provider).firstOrNull()?.id ?: models.first().id
}
