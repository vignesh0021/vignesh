package com.loadshare.areaalert.model

import java.util.UUID

data class AlertRecord(
    val id: String = UUID.randomUUID().toString(),
    val platform: String,
    val keyword: String,
    val pickup: String,
    val drop: String,
    val amount: String,
    val distance: String,
    val timestamp: Long = System.currentTimeMillis()
)
