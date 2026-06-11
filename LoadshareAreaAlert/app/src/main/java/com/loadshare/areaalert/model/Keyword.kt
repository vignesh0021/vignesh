package com.loadshare.areaalert.model

import java.util.UUID

data class Keyword(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val isEnabled: Boolean = true,
    val isExclude: Boolean = false   // true = blocked area, false = preferred area
)
