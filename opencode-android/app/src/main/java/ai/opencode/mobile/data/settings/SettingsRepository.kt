package ai.opencode.mobile.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ai.opencode.mobile.domain.model.ModelCatalog
import ai.opencode.mobile.domain.model.ProviderType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "opencode_settings")

/** Non-secret user preferences. API keys live in [ApiKeyStore], not here. */
data class AppSettings(
    val provider: ProviderType = ProviderType.ANTHROPIC,
    val modelId: String = ModelCatalog.defaultModel(ProviderType.ANTHROPIC),
    val baseUrl: String = ProviderType.ANTHROPIC.defaultBaseUrl,
    val systemPrompt: String = DEFAULT_SYSTEM_PROMPT,
) {
    companion object {
        const val DEFAULT_SYSTEM_PROMPT =
            "You are OpenCode, a concise expert coding assistant. Prefer runnable code, " +
                "explain trade-offs briefly, and use fenced code blocks with a language tag."
    }
}

class SettingsRepository(private val context: Context) {

    private object Keys {
        val PROVIDER = stringPreferencesKey("provider")
        val MODEL = stringPreferencesKey("model")
        val BASE_URL = stringPreferencesKey("base_url")
        val SYSTEM_PROMPT = stringPreferencesKey("system_prompt")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { prefs ->
        val provider = ProviderType.fromName(prefs[Keys.PROVIDER])
        AppSettings(
            provider = provider,
            modelId = prefs[Keys.MODEL] ?: ModelCatalog.defaultModel(provider),
            baseUrl = prefs[Keys.BASE_URL] ?: provider.defaultBaseUrl,
            systemPrompt = prefs[Keys.SYSTEM_PROMPT] ?: AppSettings.DEFAULT_SYSTEM_PROMPT,
        )
    }

    suspend fun setProvider(provider: ProviderType) {
        context.dataStore.edit { prefs ->
            prefs[Keys.PROVIDER] = provider.name
            prefs[Keys.MODEL] = ModelCatalog.defaultModel(provider)
            prefs[Keys.BASE_URL] = provider.defaultBaseUrl
        }
    }

    suspend fun setModel(modelId: String) {
        context.dataStore.edit { it[Keys.MODEL] = modelId }
    }

    suspend fun setBaseUrl(baseUrl: String) {
        context.dataStore.edit { it[Keys.BASE_URL] = baseUrl.trim() }
    }

    suspend fun setSystemPrompt(prompt: String) {
        context.dataStore.edit { it[Keys.SYSTEM_PROMPT] = prompt }
    }
}
