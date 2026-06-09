package com.loadshare.areaalert.model

data class OrderAlert(
    val hash: String,
    val matchedKeyword: String,
    val pickupLocation: String,
    val dropLocation: String,
    val distance: String,
    val amount: String,
    val rawText: String,
    val platform: String = "",
    val timestamp: Long = System.currentTimeMillis()
)
