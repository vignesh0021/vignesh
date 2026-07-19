package ai.opencode.mobile.ui.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.opencode.mobile.data.repository.FileNode
import ai.opencode.mobile.data.repository.WorkspaceRepository
import ai.opencode.mobile.ui.appContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

data class FilesUiState(
    val currentPath: String = "",
    val nodes: List<FileNode> = emptyList(),
    val canGoUp: Boolean = false,
    val loading: Boolean = true,
)

class FilesViewModel(
    private val workspace: WorkspaceRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(FilesUiState())
    val state: StateFlow<FilesUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            workspace.ensureSeeded()
            open(workspace.rootPath)
        }
    }

    fun open(path: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val nodes = workspace.list(File(path))
            _state.value = FilesUiState(
                currentPath = path,
                nodes = nodes,
                canGoUp = workspace.parentWithinRoot(path) != null,
                loading = false,
            )
        }
    }

    fun goUp() {
        val parent = workspace.parentWithinRoot(_state.value.currentPath) ?: return
        open(parent)
    }

    fun refresh() = open(_state.value.currentPath)

    fun createFile(name: String) {
        viewModelScope.launch {
            workspace.createFile(_state.value.currentPath, name)
            refresh()
        }
    }

    fun createDir(name: String) {
        viewModelScope.launch {
            workspace.createDir(_state.value.currentPath, name)
            refresh()
        }
    }

    fun delete(path: String) {
        viewModelScope.launch {
            workspace.delete(path)
            refresh()
        }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { FilesViewModel(appContainer().workspaceRepository) }
        }
    }
}
