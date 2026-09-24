package ai.opencode.mobile.ui.local

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.opencode.mobile.data.local.DownloadProgress
import ai.opencode.mobile.data.local.InstalledModel
import ai.opencode.mobile.data.local.LocalModelInfo
import ai.opencode.mobile.data.local.LocalModelManager
import ai.opencode.mobile.data.settings.SettingsRepository
import ai.opencode.mobile.ui.appContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class LocalModelsUiState(
    val catalog: List<LocalModelInfo> = emptyList(),
    val installed: List<InstalledModel> = emptyList(),
    val downloadingId: String? = null,
    val downloadFraction: Float = 0f,
    val busy: Boolean = false,
    val status: String? = null,
)

class LocalModelsViewModel(
    private val manager: LocalModelManager,
    private val settingsRepository: SettingsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(
        LocalModelsUiState(catalog = manager.catalog(), installed = manager.installed())
    )
    val state: StateFlow<LocalModelsUiState> = _state.asStateFlow()

    /** The currently selected on-device model path, if on-device inference is active. */
    val activePath: StateFlow<String?> = settingsRepository.settings
        .map { if (it.provider.isLocal) it.modelId else null }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private fun refreshInstalled() {
        _state.value = _state.value.copy(installed = manager.installed())
    }

    fun downloadCatalog(info: LocalModelInfo, token: String?) =
        download(info.url, info.fileName, info.id, token)

    fun downloadUrl(url: String, token: String?) {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return
        val fileName = trimmed.substringAfterLast('/').ifBlank { "model-${System.currentTimeMillis()}.task" }
        download(trimmed, fileName, "url:$trimmed", token)
    }

    private fun download(url: String, fileName: String, id: String, token: String?) {
        if (_state.value.downloadingId != null) return
        _state.value = _state.value.copy(downloadingId = id, downloadFraction = 0f, status = null)
        viewModelScope.launch {
            manager.download(url, fileName, token).collect { progress ->
                when (progress) {
                    is DownloadProgress.Running ->
                        _state.value = _state.value.copy(downloadFraction = progress.fraction)
                    is DownloadProgress.Done -> {
                        _state.value = _state.value.copy(downloadingId = null, downloadFraction = 0f, status = "Downloaded")
                        refreshInstalled()
                    }
                    is DownloadProgress.Failed ->
                        _state.value = _state.value.copy(downloadingId = null, downloadFraction = 0f, status = progress.message)
                }
            }
        }
    }

    fun import(uri: Uri) {
        _state.value = _state.value.copy(busy = true, status = null)
        viewModelScope.launch {
            val result = runCatching { manager.import(uri) }
            _state.value = _state.value.copy(
                busy = false,
                status = result.fold({ "Imported ${it.name}" }, { it.message ?: "Import failed" }),
            )
            refreshInstalled()
        }
    }

    fun delete(path: String) {
        viewModelScope.launch {
            manager.delete(path)
            refreshInstalled()
        }
    }

    fun use(path: String) {
        viewModelScope.launch {
            settingsRepository.selectLocalModel(path)
            _state.value = _state.value.copy(status = "Selected — chats now run on-device")
        }
    }

    fun clearStatus() {
        _state.value = _state.value.copy(status = null)
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val c = appContainer()
                LocalModelsViewModel(c.localModelManager, c.settingsRepository)
            }
        }
    }
}
