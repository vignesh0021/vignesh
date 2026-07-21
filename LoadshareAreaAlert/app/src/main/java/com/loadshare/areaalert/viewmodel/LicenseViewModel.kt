package com.loadshare.areaalert.viewmodel

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.license.LicenseManager
import com.loadshare.areaalert.license.LicenseStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject

@HiltViewModel
class LicenseViewModel @Inject constructor(
    private val licenseManager: LicenseManager,
    @ApplicationContext private val context: Context
) : ViewModel() {

    val deviceId: String = licenseManager.deviceId

    val status: StateFlow<LicenseStatus> = licenseManager.status
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), licenseManager.status.value)

    private val _activationMessage = MutableStateFlow<String?>(null)
    val activationMessage: StateFlow<String?> = _activationMessage.asStateFlow()

    fun activate(key: String) = viewModelScope.launch {
        if (key.isBlank()) {
            _activationMessage.value = "Please paste your license key"
            return@launch
        }
        _activationMessage.value = when (val result = licenseManager.activate(key)) {
            is LicenseStatus.Active ->
                "Activated! Valid until ${formatEpochDay(result.expiryEpochDay)}"
            is LicenseStatus.Expired ->
                "This key already expired on ${formatEpochDay(result.expiryEpochDay)}"
            is LicenseStatus.Invalid ->
                "Invalid key — check it was issued for THIS device ID"
            LicenseStatus.NotActivated ->
                "Please paste your license key"
        }
    }

    fun clearMessage() { _activationMessage.value = null }

    fun copyDeviceId() {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Device ID", deviceId))
    }

    fun expiryText(epochDay: Long): String = formatEpochDay(epochDay)

    private fun formatEpochDay(epochDay: Long): String =
        LocalDate.ofEpochDay(epochDay).format(DateTimeFormatter.ofPattern("dd MMM yyyy"))
}
