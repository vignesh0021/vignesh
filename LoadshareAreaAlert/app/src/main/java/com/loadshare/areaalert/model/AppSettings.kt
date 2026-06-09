package com.loadshare.areaalert.model

data class AppSettings(
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val overlayEnabled: Boolean = true,
    val alertVolume: Float = 1.0f,
    val isMonitoringActive: Boolean = false,
    val overlayDurationSeconds: Int = 15,  // 0 = manual dismiss, never auto-close
    val repeatAlertCount: Int = 1           // re-vibrate/sound N times at 15s intervals
)
