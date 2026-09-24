package ai.opencode.mobile.data.remote

import android.content.Context
import ai.opencode.mobile.domain.model.ProviderType
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Builds the correct [ChatClient] for a provider, reusing a single tuned OkHttp stack. */
class ChatClientFactory(context: Context) {

    private val appContext = context.applicationContext

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        // Generous read timeout: reasoning models can be slow before the first token,
        // but a finite value prevents a hung stream from blocking the UI forever.
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    // The on-device engine caches a loaded model, so keep a single instance.
    private val localClient: LocalLlmClient by lazy { LocalLlmClient(appContext) }

    fun create(provider: ProviderType): ChatClient =
        when {
            provider.isLocal -> localClient
            provider == ProviderType.ANTHROPIC -> AnthropicChatClient(http, json)
            // OpenRouter, Groq, OpenAI and any OpenAI-compatible endpoint share one client.
            else -> OpenAiChatClient(http, json)
        }
}
