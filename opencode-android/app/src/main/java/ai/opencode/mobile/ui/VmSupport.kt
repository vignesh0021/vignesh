package ai.opencode.mobile.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import ai.opencode.mobile.OpenCodeApp
import ai.opencode.mobile.di.AppContainer

/** Retrieves the app's dependency container from within a ViewModel factory. */
fun CreationExtras.appContainer(): AppContainer {
    val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as OpenCodeApp
    return app.container
}
