package ai.opencode.mobile.data.repository

import ai.opencode.mobile.data.local.SessionDao
import ai.opencode.mobile.data.local.toDomain
import ai.opencode.mobile.data.local.toEntity
import ai.opencode.mobile.data.settings.SettingsRepository
import ai.opencode.mobile.domain.model.Session
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

class SessionRepository(
    private val sessionDao: SessionDao,
    private val settingsRepository: SettingsRepository,
) {
    fun observeSessions(): Flow<List<Session>> =
        sessionDao.observeAll().map { list -> list.map { it.toDomain() } }

    suspend fun getSession(id: String): Session? = sessionDao.findById(id)?.toDomain()

    /** Creates a new session seeded with the user's current provider/model preferences. */
    suspend fun createSession(title: String? = null): Session {
        val settings = settingsRepository.settings.first()
        val session = Session(
            title = title?.takeIf { it.isNotBlank() } ?: defaultTitle(),
            provider = settings.provider,
            modelId = settings.modelId,
        )
        sessionDao.upsert(session.toEntity())
        return session
    }

    suspend fun rename(id: String, title: String) {
        sessionDao.rename(id, title.trim(), System.currentTimeMillis())
    }

    suspend fun touch(id: String) {
        sessionDao.touch(id, System.currentTimeMillis())
    }

    suspend fun delete(id: String) = sessionDao.delete(id)

    private fun defaultTitle(): String {
        val now = java.text.SimpleDateFormat("MMM d, HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date())
        return "Session $now"
    }
}
