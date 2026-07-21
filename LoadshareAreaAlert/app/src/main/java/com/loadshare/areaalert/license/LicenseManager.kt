package com.loadshare.areaalert.license

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import com.loadshare.areaalert.data.DataStoreManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

sealed class LicenseStatus {
    // No key entered yet
    data object NotActivated : LicenseStatus()
    // Key is malformed, forged, or was issued for a different device
    data object Invalid : LicenseStatus()
    // Valid key, still within the paid period
    data class Active(val expiryEpochDay: Long) : LicenseStatus()
    // Valid key but the paid period has passed
    data class Expired(val expiryEpochDay: Long) : LicenseStatus()

    val isActive: Boolean get() = this is Active
}

@Singleton
class LicenseManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dataStoreManager: DataStoreManager
) {
    // Per-device, per-app-signing-key identifier (Android 8+). Stable across app
    // reinstalls as long as the signing key and device stay the same, so a purchased
    // license keeps working after a reinstall. The customer reads this off the
    // Activate screen and sends it to the seller.
    @SuppressLint("HardwareIds")
    val deviceId: String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        // Anti-rollback high-water mark: record the furthest date we've ever seen so a
        // user can't extend an expired license by moving the device clock backwards.
        scope.launch {
            while (true) {
                dataStoreManager.bumpLastSeenEpochDay(LocalDate.now().toEpochDay())
                delay(60 * 60 * 1000L) // hourly
            }
        }
    }

    // Live status the UI and the accessibility service both observe. Recomputed when the
    // stored key changes, when the anti-rollback mark advances, and hourly (to flip to
    // Expired the moment the paid period ends).
    val status: StateFlow<LicenseStatus> = combine(
        dataStoreManager.licenseKey,
        dataStoreManager.lastSeenEpochDay,
        flow { while (true) { emit(Unit); delay(60 * 60 * 1000L) } }
    ) { key, lastSeen, _ -> compute(key, lastSeen) }
        .stateIn(scope, SharingStarted.Eagerly, LicenseStatus.NotActivated)

    private fun compute(key: String, lastSeen: Long): LicenseStatus {
        if (key.isBlank()) return LicenseStatus.NotActivated
        val info = LicenseVerifier.verify(key) ?: return LicenseStatus.Invalid
        if (info.deviceId != deviceId) return LicenseStatus.Invalid
        val today = LocalDate.now().toEpochDay()
        // Use the later of "today" and the high-water mark so a clock rollback can't
        // revive an expired license.
        val effectiveToday = maxOf(today, lastSeen)
        return if (effectiveToday > info.expiryEpochDay) {
            LicenseStatus.Expired(info.expiryEpochDay)
        } else {
            LicenseStatus.Active(info.expiryEpochDay)
        }
    }

    // Attempts to activate the given key. Persists it only if the signature is authentic
    // and it was issued for this device. Returns the resulting status.
    suspend fun activate(key: String): LicenseStatus {
        val trimmed = key.trim()
        val info = LicenseVerifier.verify(trimmed)
        if (info == null || info.deviceId != deviceId) return LicenseStatus.Invalid
        dataStoreManager.updateLicenseKey(trimmed)
        val lastSeen = dataStoreManager.lastSeenEpochDay.first()
        return compute(trimmed, lastSeen)
    }

    // Synchronous check used by the accessibility service on every event — reads the
    // cached StateFlow value, no I/O.
    fun isCurrentlyActive(): Boolean = status.value.isActive
}
