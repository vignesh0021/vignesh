package ai.opencode.mobile.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.opencode.mobile.data.settings.ApiKeyStore
import ai.opencode.mobile.data.settings.AppSettings
import ai.opencode.mobile.data.settings.SettingsRepository
import ai.opencode.mobile.domain.model.AiModel
import ai.opencode.mobile.domain.model.ModelCatalog
import ai.opencode.mobile.domain.model.ProviderType
import ai.opencode.mobile.ui.appContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val settingsRepository: SettingsRepository,
    private val apiKeyStore: ApiKeyStore,
) : ViewModel() {

    val settings: StateFlow<AppSettings> = settingsRepository.settings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppSettings())

    /** Emits whenever a key is saved/cleared so the UI can refresh its "key set" badge. */
    private val _keyStatus = MutableStateFlow(currentKeyStatus())
    val keyStatus: StateFlow<Map<ProviderType, Boolean>> = _keyStatus.asStateFlow()

    fun modelsFor(provider: ProviderType): List<AiModel> = ModelCatalog.forProvider(provider)

    fun setProvider(provider: ProviderType) {
        viewModelScope.launch {
            settingsRepository.setProvider(provider)
            _keyStatus.value = currentKeyStatus()
        }
    }

    fun setModel(modelId: String) {
        viewModelScope.launch { settingsRepository.setModel(modelId) }
    }

    fun setBaseUrl(url: String) {
        viewModelScope.launch { settingsRepository.setBaseUrl(url) }
    }

    fun setSystemPrompt(prompt: String) {
        viewModelScope.launch { settingsRepository.setSystemPrompt(prompt) }
    }

    fun saveApiKey(provider: ProviderType, key: String) {
        apiKeyStore.setKey(provider, key)
        _keyStatus.value = currentKeyStatus()
    }

    fun clearApiKey(provider: ProviderType) {
        apiKeyStore.clearKey(provider)
        _keyStatus.value = currentKeyStatus()
    }

    private fun currentKeyStatus(): Map<ProviderType, Boolean> =
        ProviderType.entries.associateWith { apiKeyStore.hasKey(it) }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val c = appContainer()
                SettingsViewModel(c.settingsRepository, c.apiKeyStore)
            }
        }
    }
}
