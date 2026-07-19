package ai.opencode.mobile.data.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ai.opencode.mobile.domain.model.ProviderType
import ai.opencode.mobile.util.Logger

/**
 * Stores provider API keys at rest using AES-256 via the Android Keystore. If the
 * encrypted store cannot be initialised on a given device (rare OEM Keystore bugs) we
 * degrade gracefully to an in-memory map so the app stays usable for that session
 * without ever writing plaintext keys to disk.
 */
class ApiKeyStore(context: Context) {

    private val prefs: SharedPreferences? = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "opencode_secure_keys",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (t: Throwable) {
        Logger.e("Falling back to in-memory key store; encrypted prefs unavailable", t)
        null
    }

    private val fallback = mutableMapOf<String, String>()

    private fun keyName(provider: ProviderType) = "api_key_${provider.name}"

    fun getKey(provider: ProviderType): String? {
        val name = keyName(provider)
        val value = prefs?.getString(name, null) ?: fallback[name]
        return value?.takeIf { it.isNotBlank() }
    }

    fun setKey(provider: ProviderType, key: String) {
        val name = keyName(provider)
        val trimmed = key.trim()
        if (prefs != null) {
            prefs.edit().putString(name, trimmed).apply()
        } else {
            fallback[name] = trimmed
        }
    }

    fun clearKey(provider: ProviderType) {
        val name = keyName(provider)
        prefs?.edit()?.remove(name)?.apply()
        fallback.remove(name)
    }

    fun hasKey(provider: ProviderType): Boolean = getKey(provider) != null
}
