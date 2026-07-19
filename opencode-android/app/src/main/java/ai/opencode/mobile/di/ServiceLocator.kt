package ai.opencode.mobile.di

import android.content.Context
import ai.opencode.mobile.data.local.AppDatabase
import ai.opencode.mobile.data.remote.ChatClientFactory
import ai.opencode.mobile.data.repository.ChatRepository
import ai.opencode.mobile.data.repository.SessionRepository
import ai.opencode.mobile.data.repository.WorkspaceRepository
import ai.opencode.mobile.data.settings.ApiKeyStore
import ai.opencode.mobile.data.settings.SettingsRepository
import java.io.File

/**
 * A tiny manual dependency container. We deliberately avoid annotation-processor DI
 * frameworks here to keep the CI build fast and free of codegen version pitfalls; the
 * graph is small enough that constructor wiring stays readable.
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext
    private val database = AppDatabase.get(appContext)

    val settingsRepository: SettingsRepository by lazy { SettingsRepository(appContext) }
    val apiKeyStore: ApiKeyStore by lazy { ApiKeyStore(appContext) }
    private val chatClientFactory: ChatClientFactory by lazy { ChatClientFactory() }

    val sessionRepository: SessionRepository by lazy {
        SessionRepository(database.sessionDao(), settingsRepository)
    }

    val chatRepository: ChatRepository by lazy {
        ChatRepository(
            messageDao = database.messageDao(),
            sessionDao = database.sessionDao(),
            settingsRepository = settingsRepository,
            apiKeyStore = apiKeyStore,
            clientFactory = chatClientFactory,
        )
    }

    val workspaceRepository: WorkspaceRepository by lazy {
        val base = appContext.getExternalFilesDir(null) ?: appContext.filesDir
        WorkspaceRepository(File(base, "workspace"))
    }
}
