package com.loadshare.areaalert.alert

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.*
import androidx.core.app.NotificationCompat
import com.loadshare.areaalert.MainActivity
import com.loadshare.areaalert.R
import com.loadshare.areaalert.data.AlertHistoryRepository
import com.loadshare.areaalert.data.GeoZoneRepository
import com.loadshare.areaalert.model.AlertRecord
import com.loadshare.areaalert.model.AppSettings
import com.loadshare.areaalert.model.DeliveryPlatform
import com.loadshare.areaalert.model.GeoZone
import com.loadshare.areaalert.model.OrderAlert
import com.loadshare.areaalert.service.OverlayService
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.Calendar
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.*

@Singleton
class AlertManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val geocodingService: GeocodingService,
    private val geoZoneRepository: GeoZoneRepository,
    private val alertHistoryRepository: AlertHistoryRepository
) {
    companion object {
        private const val ALERT_CHANNEL_ID = "loadshare_alerts"
        // 5-minute dedup: prevents re-alerting the same order while the user is
        // actively on the Loadshare screen after accepting it.
        private const val DUPLICATE_WINDOW_MS = 300_000L
        private const val NOTIFICATION_ID_BASE = 2000
    }

    private val recentHashes = ConcurrentHashMap<String, Long>()
    private var notificationCounter = NOTIFICATION_ID_BASE
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var cachedZones: List<GeoZone> = emptyList()

    // Snooze: user tapped "Snooze" on overlay after accepting an order.
    // All processScreenText calls return early until snooze expires.
    @Volatile private var snoozeUntilMs = 0L

    fun snoozeFor(durationMs: Long) {
        snoozeUntilMs = System.currentTimeMillis() + durationMs
    }

    fun isSnoozed(): Boolean = System.currentTimeMillis() < snoozeUntilMs

    fun snoozeRemainingSeconds(): Int =
        ((snoozeUntilMs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0).toInt()

    @Volatile private var currentPackageName = ""

    init {
        createAlertNotificationChannel()
        scope.launch {
            geoZoneRepository.zones.collect { zones -> cachedZones = zones }
        }
    }

    fun hasEnabledZones(): Boolean = cachedZones.any { it.isEnabled }

    fun triggerTestAlert(settings: AppSettings) {
        val test = OrderAlert(
            hash = "test_${System.currentTimeMillis()}",
            matchedKeyword = "TEST",
            pickupLocation = "Sholinganallur, Chennai",
            dropLocation = "ECR, Chennai",
            distance = "5 km",
            amount = "₹120",
            rawText = "test",
            platform = "Test Alert"
        )
        triggerAlert(test, settings)
    }

    fun processScreenText(
        fullText: String,
        enabledKeywords: List<String>,
        excludedKeywords: List<String> = emptyList(),
        settings: AppSettings,
        packageName: String = ""
    ) {
        // Working hours gate — silently skip all processing outside configured hours
        if (!isWithinWorkingHours(settings)) return
        // Snooze gate — user tapped "Snooze" on the overlay after accepting an order
        if (isSnoozed()) return

        currentPackageName = packageName
        val platform = DeliveryPlatform.fromPackageName(packageName)

        // Exclusion check on short lines: if a blocked-area keyword appears anywhere
        // in a non-geocoded line, skip this order entirely regardless of include keywords.
        val shortLineText = OrderTextParser.shortLineText(fullText)

        if (OrderTextParser.containsExcludedKeyword(shortLineText, excludedKeywords)) {
            return
        }

        // Keyword match: only check short lines (≤60 chars) to avoid matching area names
        // that appear embedded inside long geocoded address strings.
        val matchedKeyword = OrderTextParser.findMatchedKeyword(shortLineText, enabledKeywords)
        if (matchedKeyword != null) {
            val orderAlert = extractOrderInfo(fullText, matchedKeyword, platform)

            // Drop-only mode: keyword must appear in drop address, not just pickup
            if (settings.matchDropLocationOnly &&
                orderAlert.dropLocation != "N/A" &&
                !orderAlert.dropLocation.contains(matchedKeyword, ignoreCase = true)) {
                return
            }

            // Amount filter: skip orders below the minimum (parsed from "₹87" → 87)
            if (settings.minAmountRupees > 0) {
                val amount = parseAmountValue(orderAlert.amount)
                if (amount in 1 until settings.minAmountRupees) return
            }

            // Distance filter: skip orders above the maximum (parsed from "3.0 km" → 3.0)
            if (settings.maxDistanceKm > 0) {
                val distKm = parseDistanceValue(orderAlert.distance)
                if (distKm > 0 && distKm > settings.maxDistanceKm) return
            }

            val stableKey = "${matchedKeyword}|${orderAlert.amount}|${orderAlert.pickupLocation.take(60)}"
            val hash = computeHash(stableKey)
            if (!isDuplicate(hash)) {
                recordHash(hash)
                triggerAlert(orderAlert.copy(hash = hash), settings)
            }
            return
        }

        // Geo zone match: async geocoding, only when no keyword fired
        val enabledZones = cachedZones.filter { it.isEnabled }
        if (enabledZones.isNotEmpty()) {
            scope.launch { checkGeoZones(fullText, enabledZones, settings, platform) }
        }
    }

    private fun isWithinWorkingHours(settings: AppSettings): Boolean =
        OrderTextParser.isWithinWorkingHours(
            settings.workingHoursEnabled,
            settings.workStartHour,
            settings.workEndHour,
            Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        )

    private fun parseAmountValue(amountStr: String): Int = OrderTextParser.parseAmountValue(amountStr)

    private fun parseDistanceValue(distanceStr: String): Double = OrderTextParser.parseDistanceValue(distanceStr)

    private suspend fun checkGeoZones(
        fullText: String,
        zones: List<GeoZone>,
        settings: AppSettings,
        platform: DeliveryPlatform
    ) {
        val orderInfo = extractOrderInfo(fullText, "", platform)
        val candidates = listOf(orderInfo.pickupLocation, orderInfo.dropLocation)
            .filter { it != "N/A" && it.length > 3 }
        if (candidates.isEmpty()) return

        for (address in candidates) {
            val latLng = geocodingService.geocode(address) ?: continue
            val matchedZone = zones.firstOrNull { zone ->
                haversineKm(latLng.lat, latLng.lng, zone.lat, zone.lng) <= zone.radiusKm
            } ?: continue

            val alert = extractOrderInfo(fullText, "Zone: ${matchedZone.name}", platform)
            val stableKey = "zone|${matchedZone.name}|${alert.amount}|${alert.pickupLocation.take(60)}"
            val hash = computeHash(stableKey)
            if (isDuplicate(hash)) return
            recordHash(hash)
            triggerAlert(alert.copy(hash = hash), settings)
            return
        }
    }

    private fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return r * 2 * asin(sqrt(a))
    }

    // ── Platform-aware order info extraction ─────────────────────────────────

    private fun extractOrderInfo(
        text: String,
        keyword: String,
        platform: DeliveryPlatform
    ): OrderAlert {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val (pickup, drop) = OrderTextParser.extractLocations(platform, lines)

        return OrderAlert(
            hash = "",
            matchedKeyword = keyword,
            pickupLocation = pickup,
            dropLocation = drop,
            distance = OrderTextParser.extractDistance(text) ?: "N/A",
            amount = OrderTextParser.extractAmount(text) ?: "N/A",
            rawText = text.take(500),
            platform = platform.displayName
        )
    }

    // ── Hash & deduplication ──────────────────────────────────────────────────

    private fun computeHash(text: String): String {
        val normalized = text.trim().lowercase().replace(Regex("\\s+"), " ")
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(normalized.toByteArray())
        return bytes.take(8).joinToString("") { "%02x".format(it) }
    }

    private fun isDuplicate(hash: String): Boolean {
        val now = System.currentTimeMillis()
        val lastSeen = recentHashes[hash] ?: return false
        return (now - lastSeen) < DUPLICATE_WINDOW_MS
    }

    private fun recordHash(hash: String) {
        val now = System.currentTimeMillis()
        recentHashes[hash] = now
        recentHashes.entries.removeIf { (now - it.value) > DUPLICATE_WINDOW_MS * 2 }
    }

    // ── Alert triggering ──────────────────────────────────────────────────────

    private fun triggerAlert(alert: OrderAlert, settings: AppSettings) {
        if (settings.vibrationEnabled) vibrate()
        if (settings.soundEnabled) playSound(settings.alertVolume, settings.alertSoundUri)
        if (settings.overlayEnabled) showOverlay(alert, settings)
        sendNotification(alert)
        scope.launch { saveHistory(alert) }
        // Re-alert at 15s intervals so missed orders still get attention
        if (settings.repeatAlertCount > 0) {
            scope.launch {
                repeat(settings.repeatAlertCount) {
                    delay(15_000L)
                    if (settings.vibrationEnabled) vibrate()
                    if (settings.soundEnabled) playSound(settings.alertVolume, settings.alertSoundUri)
                }
            }
        }
    }

    private suspend fun saveHistory(alert: OrderAlert) {
        alertHistoryRepository.addRecord(
            AlertRecord(
                platform = alert.platform,
                keyword = alert.matchedKeyword,
                pickup = alert.pickupLocation,
                drop = alert.dropLocation,
                amount = alert.amount,
                distance = alert.distance
            )
        )
    }

    private fun vibrate() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                manager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (!vibrator.hasVibrator()) return
            val effect = VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400, 200, 800), -1)
            // Without alarm-usage attributes the vibration is suppressed in silent/DND
            // mode and on Samsung/Xiaomi ROMs when triggered from a background service.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(
                    effect,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
            }
        } catch (_: Exception) {}
    }

    private fun playSound(volume: Float, customSoundUri: String = "") {
        val defaultUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val customUri = customSoundUri.takeIf { it.isNotBlank() }?.let { Uri.parse(it) }
        val played = customUri != null && playUri(customUri, volume)
        // Custom tone may have been deleted from the device — fall back to default
        if (!played && defaultUri != null) playUri(defaultUri, volume)
    }

    private fun playUri(uri: Uri, volume: Float): Boolean = try {
        // Use USAGE_ALARM so the sound plays even during phone calls.
        // prepareAsync() is non-blocking — sound starts as soon as the system
        // has buffered enough, eliminating the small freeze from prepare().
        MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            setDataSource(context, uri)
            setVolume(volume, volume)
            setOnPreparedListener { it.start() }
            setOnCompletionListener { it.release() }
            prepareAsync()
        }
        true
    } catch (_: Exception) { false }

    private fun showOverlay(alert: OrderAlert, settings: AppSettings) {
        val durationMs = if (settings.overlayDurationSeconds == 0) 0L
                         else settings.overlayDurationSeconds * 1000L
        val intent = Intent(context, OverlayService::class.java).apply {
            putExtra(OverlayService.EXTRA_PLATFORM, alert.platform)
            putExtra(OverlayService.EXTRA_MATCHED_KEYWORD, alert.matchedKeyword)
            putExtra(OverlayService.EXTRA_PICKUP, alert.pickupLocation)
            putExtra(OverlayService.EXTRA_DROP, alert.dropLocation)
            putExtra(OverlayService.EXTRA_DISTANCE, alert.distance)
            putExtra(OverlayService.EXTRA_AMOUNT, alert.amount)
            putExtra(OverlayService.EXTRA_PACKAGE_NAME, currentPackageName)
            putExtra(OverlayService.EXTRA_DURATION_MS, durationMs)
        }
        context.startService(intent)
    }

    private fun sendNotification(alert: OrderAlert) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val platformLabel = if (alert.platform.isNotEmpty()) "[${alert.platform}] " else ""

        val notification = NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("${platformLabel}Preferred Area Order Found!")
            .setContentText("${alert.matchedKeyword} · ${alert.amount}")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(
                        "App: ${alert.platform}\n" +
                        "Keyword: ${alert.matchedKeyword}\n" +
                        "Pickup: ${alert.pickupLocation}\n" +
                        "Drop: ${alert.dropLocation}\n" +
                        "Distance: ${alert.distance}\n" +
                        "Amount: ${alert.amount}"
                    )
            )
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .build()

        notificationManager.notify(notificationCounter++, notification)
    }

    private fun createAlertNotificationChannel() {
        val channel = NotificationChannel(
            ALERT_CHANNEL_ID,
            "Order Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Alerts when preferred area orders are detected"
            enableVibration(false)
            setSound(null, null)
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }
}
