package ai.opencode.mobile

import android.app.Application
import ai.opencode.mobile.di.AppContainer

class OpenCodeApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
