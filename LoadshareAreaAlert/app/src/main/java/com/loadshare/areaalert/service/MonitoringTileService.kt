package com.loadshare.areaalert.service

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.loadshare.areaalert.data.SettingsRepository
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

// Quick Settings tile: toggle monitoring on/off in two taps from any screen,
// without leaving the Loadshare app mid-delivery.
class MonitoringTileService : TileService() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface MonitoringTileEntryPoint {
        fun settingsRepository(): SettingsRepository
    }

    private val settingsRepository: SettingsRepository
        get() = EntryPointAccessors.fromApplication(
            applicationContext, MonitoringTileEntryPoint::class.java
        ).settingsRepository()

    private var scope: CoroutineScope? = null

    override fun onStartListening() {
        super.onStartListening()
        val newScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
        scope = newScope
        newScope.launch {
            settingsRepository.appSettings.collect { settings ->
                qsTile?.apply {
                    state = if (settings.isMonitoringActive) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
                    label = "Area Alert"
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        subtitle = if (settings.isMonitoringActive) "Monitoring" else "Paused"
                    }
                    updateTile()
                }
            }
        }
    }

    override fun onStopListening() {
        scope?.cancel()
        scope = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        CoroutineScope(Dispatchers.IO + Job()).launch {
            val current = settingsRepository.appSettings.first().isMonitoringActive
            settingsRepository.setMonitoringActive(!current)
        }
    }
}
