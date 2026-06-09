package com.loadshare.areaalert.model

import java.util.UUID

data class GeoZone(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val lat: Double,
    val lng: Double,
    val radiusKm: Double = 5.0,
    val isEnabled: Boolean = true
)
