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
