package com.loadshare.areaalert.alert

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.*
import androidx.core.app.NotificationCompat
import com.loadshare.areaalert.MainActivity
import com.loadshare.areaalert.R
import com.loadshare.areaalert.data.GeoZoneRepository
import com.loadshare.areaalert.model.AppSettings
import com.loadshare.areaalert.model.GeoZone
import com.loadshare.areaalert.model.OrderAlert
import com.loadshare.areaalert.service.OverlayService
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.*

@Singleton
class AlertManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val geocodingService: GeocodingService,
    private val geoZoneRepository: GeoZoneRepository
) {
    companion object {
        private const val ALERT_CHANNEL_ID = "loadshare_alerts"
        private const val DUPLICATE_WINDOW_MS = 30_000L
        private const val NOTIFICATION_ID_BASE = 2000
    }

    private val recentHashes = ConcurrentHashMap<String, Long>()
    private var notificationCounter = NOTIFICATION_ID_BASE
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var cachedZones: List<GeoZone> = emptyList()

    init {
        createAlertNotificationChannel()
        scope.launch {
            geoZoneRepository.zones.collect { zones -> cachedZones = zones }
        }
    }

    fun hasEnabledZones(): Boolean = cachedZones.any { it.isEnabled }

    fun processScreenText(
        fullText: String,
        enabledKeywords: List<String>,
        settings: AppSettings
    ) {
        // Keyword match: fast, no network required
        val matchedKeyword = enabledKeywords.firstOrNull { keyword ->
            fullText.contains(keyword, ignoreCase = true)
        }
        if (matchedKeyword != null) {
            val orderAlert = extractOrderInfo(fullText, matchedKeyword)
            val hash = computeHash(orderAlert.rawText)
            if (!isDuplicate(hash)) {
                recordHash(hash)
                triggerAlert(orderAlert.copy(hash = hash), settings)
            }
            return
        }

        // Geo zone match: async geocoding, only fires when no keyword matched
        val enabledZones = cachedZones.filter { it.isEnabled }
        if (enabledZones.isNotEmpty()) {
            scope.launch { checkGeoZones(fullText, enabledZones, settings) }
        }
    }

    private suspend fun checkGeoZones(
        fullText: String,
        zones: List<GeoZone>,
        settings: AppSettings
    ) {
        val orderInfo = extractOrderInfo(fullText, "")
        val candidates = listOf(orderInfo.pickupLocation, orderInfo.dropLocation)
            .filter { it != "N/A" && it.length > 3 }
        if (candidates.isEmpty()) return

        for (address in candidates) {
            val latLng = geocodingService.geocode(address) ?: continue
            val matchedZone = zones.firstOrNull { zone ->
                haversineKm(latLng.lat, latLng.lng, zone.lat, zone.lng) <= zone.radiusKm
            } ?: continue

            val hash = computeHash(fullText.take(500) + "_zone")
            if (isDuplicate(hash)) return
            recordHash(hash)

            val alert = extractOrderInfo(fullText, "Zone: ${matchedZone.name}")
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

    private fun extractOrderInfo(text: String, keyword: String): OrderAlert {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }

        val pickup = extractField(lines, listOf("pickup", "pick up", "from", "collect")) ?: "N/A"
        val drop = extractField(lines, listOf("drop", "deliver", "delivery", "to")) ?: "N/A"
        val distance = extractDistance(text) ?: "N/A"
        val amount = extractAmount(text) ?: "N/A"

        return OrderAlert(
            hash = "",
            matchedKeyword = keyword,
            pickupLocation = pickup,
            dropLocation = drop,
            distance = distance,
            amount = amount,
            rawText = text.take(500)
        )
    }

    private fun extractField(lines: List<String>, labels: List<String>): String? {
        for (i in lines.indices) {
            val line = lines[i].lowercase()
            if (labels.any { line.contains(it) }) {
                val value = lines.getOrNull(i + 1)?.takeIf { it.isNotEmpty() }
                if (value != null) return value
                val inline = lines[i].substringAfter(":").trim()
                if (inline.isNotEmpty()) return inline
            }
        }
        return null
    }

    private fun extractDistance(text: String): String? {
        val pattern = Regex("""(\d+\.?\d*)\s*(km|kilometer|kilometers|kms)""", RegexOption.IGNORE_CASE)
        return pattern.find(text)?.value
    }

    private fun extractAmount(text: String): String? {
        val patterns = listOf(
            Regex("""₹\s*(\d+\.?\d*)"""),
            Regex("""Rs\.?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""(\d+\.?\d*)\s*₹""")
        )
        for (pattern in patterns) {
            val match = pattern.find(text)
            if (match != null) return match.value.trim()
        }
        return null
    }

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
        val expired = recentHashes.entries.filter { (now - it.value) > DUPLICATE_WINDOW_MS * 2 }
        expired.forEach { recentHashes.remove(it.key) }
    }

    private fun triggerAlert(alert: OrderAlert, settings: AppSettings) {
        if (settings.vibrationEnabled) vibrate()
        if (settings.soundEnabled) playSound(settings.alertVolume)
        if (settings.overlayEnabled) showOverlay(alert)
        sendNotification(alert)
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 300, 150, 300, 150, 600)
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    private fun playSound(volume: Float) {
        try {
            val maxVolume = (volume * ToneGenerator.MAX_VOLUME).toInt().coerceIn(1, ToneGenerator.MAX_VOLUME)
            val toneGen = ToneGenerator(AudioManager.STREAM_NOTIFICATION, maxVolume)
            toneGen.startTone(ToneGenerator.TONE_PROP_BEEP2, 800)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                toneGen.release()
            }, 1000)
        } catch (_: Exception) {}
    }

    private fun showOverlay(alert: OrderAlert) {
        val intent = Intent(context, OverlayService::class.java).apply {
            putExtra(OverlayService.EXTRA_MATCHED_KEYWORD, alert.matchedKeyword)
            putExtra(OverlayService.EXTRA_PICKUP, alert.pickupLocation)
            putExtra(OverlayService.EXTRA_DROP, alert.dropLocation)
            putExtra(OverlayService.EXTRA_DISTANCE, alert.distance)
            putExtra(OverlayService.EXTRA_AMOUNT, alert.amount)
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

        val notification = NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Preferred Area Order Found!")
            .setContentText("${alert.matchedKeyword} - ${alert.amount}")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(
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
