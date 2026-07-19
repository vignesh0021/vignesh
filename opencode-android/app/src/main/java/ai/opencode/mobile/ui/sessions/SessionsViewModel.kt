package ai.opencode.mobile.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.opencode.mobile.data.repository.SessionRepository
import ai.opencode.mobile.domain.model.Session
import ai.opencode.mobile.ui.appContainer
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SessionsViewModel(
    private val sessionRepository: SessionRepository,
) : ViewModel() {

    val sessions: StateFlow<List<Session>> = sessionRepository.observeSessions()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun createSession(onCreated: (String) -> Unit) {
        viewModelScope.launch {
            val session = sessionRepository.createSession()
            onCreated(session.id)
        }
    }

    fun rename(id: String, title: String) {
        viewModelScope.launch { sessionRepository.rename(id, title) }
    }

    fun delete(id: String) {
        viewModelScope.launch { sessionRepository.delete(id) }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { SessionsViewModel(appContainer().sessionRepository) }
        }
    }
}
