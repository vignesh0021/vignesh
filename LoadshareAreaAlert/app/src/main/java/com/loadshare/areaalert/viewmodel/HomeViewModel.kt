package com.loadshare.areaalert.viewmodel

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.alert.AlertManager
import com.loadshare.areaalert.data.SettingsRepository
import com.loadshare.areaalert.model.AppSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val alertManager: AlertManager,
    @ApplicationContext private val context: Context
) : ViewModel() {

    val appSettings: StateFlow<AppSettings> = settingsRepository.appSettings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), AppSettings())

    // True when monitoring is ON but no heartbeat has been received for >3 minutes —
    // the service registered but is no longer processing events.
    val serviceStale: StateFlow<Boolean> = combine(
        settingsRepository.appSettings,
        settingsRepository.lastServiceHeartbeat,
        flow { while (true) { emit(Unit); delay(30_000L) } }
    ) { settings, heartbeat, _ ->
        settings.isMonitoringActive && heartbeat > 0L &&
            (System.currentTimeMillis() - heartbeat) > 3 * 60_000L
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun setSoundEnabled(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setSoundEnabled(enabled)
    }

    fun setVibrationEnabled(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setVibrationEnabled(enabled)
    }

    fun setOverlayEnabled(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setOverlayEnabled(enabled)
    }

    fun setAlertVolume(volume: Float) = viewModelScope.launch {
        settingsRepository.setAlertVolume(volume)
    }

    fun setMonitoringActive(active: Boolean) = viewModelScope.launch {
        settingsRepository.setMonitoringActive(active)
    }

    fun setOverlayDuration(seconds: Int) = viewModelScope.launch {
        settingsRepository.setOverlayDuration(seconds)
    }

    fun setRepeatAlertCount(count: Int) = viewModelScope.launch {
        settingsRepository.setRepeatAlertCount(count)
    }

    fun setAutoDismiss(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setAutoDismiss(enabled)
    }

    fun setMatchDropOnly(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setMatchDropOnly(enabled)
    }

    fun setMinAmount(rupees: Int) = viewModelScope.launch {
        settingsRepository.setMinAmount(rupees)
    }

    fun setMaxDistance(km: Int) = viewModelScope.launch {
        settingsRepository.setMaxDistance(km)
    }

    fun setWorkingHoursEnabled(enabled: Boolean) = viewModelScope.launch {
        settingsRepository.setWorkingHoursEnabled(enabled)
    }

    fun setWorkStartHour(hour: Int) = viewModelScope.launch {
        settingsRepository.setWorkStartHour(hour)
    }

    fun setWorkEndHour(hour: Int) = viewModelScope.launch {
        settingsRepository.setWorkEndHour(hour)
    }

    fun triggerTestAlert() = viewModelScope.launch {
        val settings = settingsRepository.appSettings.first()
        alertManager.triggerTestAlert(settings)
    }

    fun isAccessibilityServiceEnabled(): Boolean {
        val serviceId = "${context.packageName}/.service.AccessibilityMonitorService"
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.split(":").any { it.equals(serviceId, ignoreCase = true) }
    }

    fun isBatteryOptimizationEnabled(): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return !pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun openAccessibilitySettings() {
        context.startActivity(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        )
    }

    fun canDrawOverlays(): Boolean = Settings.canDrawOverlays(context)

    fun openOverlaySettings() {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}"))
                .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        )
    }

    fun openBatteryOptimizationSettings() {
        context.startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:${context.packageName}"))
                .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        )
    }
}
