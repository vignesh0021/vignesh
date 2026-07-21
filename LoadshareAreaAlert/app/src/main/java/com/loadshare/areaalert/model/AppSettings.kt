package com.loadshare.areaalert.model

data class AppSettings(
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val overlayEnabled: Boolean = true,
    val alertVolume: Float = 1.0f,
    val alertSoundUri: String = "",     // "" = system default alarm tone
    val isMonitoringActive: Boolean = false,
    val overlayDurationSeconds: Int = 15,
    val repeatAlertCount: Int = 1,
    val autoDismissNonAreaOrders: Boolean = false,
    val matchDropLocationOnly: Boolean = false,
    // Order filters
    val minAmountRupees: Int = 0,       // 0 = no filter; alert only when amount >= this
    val maxDistanceKm: Int = 0,         // 0 = no filter; alert only when distance <= this
    // Working hours
    val workingHoursEnabled: Boolean = false,
    val workStartHour: Int = 8,         // 24h format (8 = 8 AM)
    val workEndHour: Int = 21,          // 24h format (21 = 9 PM)
    // Auto-accept: when true, the service taps "Choose Order"/"Accept" automatically
    // for preferred-area orders that pass all filters. Default OFF (risky).
    val autoAcceptEnabled: Boolean = false
)
