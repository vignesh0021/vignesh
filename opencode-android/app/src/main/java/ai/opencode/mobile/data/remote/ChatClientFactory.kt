package ai.opencode.mobile.data.remote

import ai.opencode.mobile.domain.model.ProviderType
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Builds the correct [ChatClient] for a provider, reusing a single tuned OkHttp stack. */
class ChatClientFactory {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        // Long read timeout: streaming responses can be idle between tokens.
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    fun create(provider: ProviderType): ChatClient = when (provider) {
        ProviderType.ANTHROPIC -> AnthropicChatClient(http, json)
        ProviderType.OPENAI, ProviderType.OPENAI_COMPATIBLE -> OpenAiChatClient(http, json)
    }
}
