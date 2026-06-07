package com.loadshare.areaalert.model

data class AppSettings(
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val overlayEnabled: Boolean = true,
    val alertVolume: Float = 1.0f,
    val isMonitoringActive: Boolean = false
)
