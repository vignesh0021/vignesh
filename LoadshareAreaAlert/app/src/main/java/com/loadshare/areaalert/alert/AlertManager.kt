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
        private const val DUPLICATE_WINDOW_MS = 30_000L
        private const val NOTIFICATION_ID_BASE = 2000
    }

    private val recentHashes = ConcurrentHashMap<String, Long>()
    private var notificationCounter = NOTIFICATION_ID_BASE
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var cachedZones: List<GeoZone> = emptyList()

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
        settings: AppSettings,
        packageName: String = ""
    ) {
        // Working hours gate — silently skip all processing outside configured hours
        if (!isWithinWorkingHours(settings)) return

        currentPackageName = packageName
        val platform = DeliveryPlatform.fromPackageName(packageName)

        // Keyword match: only check short lines (≤60 chars) to avoid matching area names
        // that appear embedded inside long geocoded address strings.
        val shortLineText = fullText.lines()
            .map { it.trim() }
            .filter { it.length in 2..60 }
            .joinToString("\n")

        val matchedKeyword = enabledKeywords.firstOrNull { keyword ->
            shortLineText.contains(keyword, ignoreCase = true)
        }
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

    private fun isWithinWorkingHours(settings: AppSettings): Boolean {
        if (!settings.workingHoursEnabled) return true
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        // Handle schedules that cross midnight (e.g. 22:00–06:00)
        return if (settings.workStartHour <= settings.workEndHour) {
            hour >= settings.workStartHour && hour < settings.workEndHour
        } else {
            hour >= settings.workStartHour || hour < settings.workEndHour
        }
    }

    private fun parseAmountValue(amountStr: String): Int =
        Regex("""\d+""").find(amountStr)?.value?.toIntOrNull() ?: 0

    private fun parseDistanceValue(distanceStr: String): Double =
        Regex("""(\d+\.?\d*)""").find(distanceStr)?.value?.toDoubleOrNull() ?: 0.0

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

        val (pickup, drop) = when (platform) {
            DeliveryPlatform.ZOMATO   -> extractZomatoLocations(lines, text)
            DeliveryPlatform.SWIGGY   -> extractSwiggyLocations(lines, text)
            DeliveryPlatform.RAPIDO   -> extractRapidoLocations(lines, text)
            DeliveryPlatform.PORTER   -> extractPorterLocations(lines, text)
            DeliveryPlatform.DUNZO    -> extractDunzoLocations(lines, text)
            DeliveryPlatform.BLINKIT,
            DeliveryPlatform.ZEPTO,
            DeliveryPlatform.BIGBASKET -> extractQuickCommerceLocations(lines, text)
            else                       -> extractGenericLocations(lines)
        }

        return OrderAlert(
            hash = "",
            matchedKeyword = keyword,
            pickupLocation = pickup,
            dropLocation = drop,
            distance = extractDistance(text) ?: "N/A",
            amount = extractAmount(text) ?: "N/A",
            rawText = text.take(500),
            platform = platform.displayName
        )
    }

    // Zomato: Restaurant → pickup, Customer area → drop
    private fun extractZomatoLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pick up from", "pick up at", "restaurant", "outlet"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "delivery at", "drop at", "customer"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Swiggy: similar to Zomato but different label wording
    private fun extractSwiggyLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pick up", "pickup from", "store", "restaurant"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "drop", "delivery location", "customer address"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Rapido: ride pickup → drop
    private fun extractRapidoLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "pick up", "from", "start"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("drop", "destination", "to", "end"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Porter: goods transport pickup → drop
    private fun extractPorterLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "from", "collect from", "loading"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("drop", "to", "deliver at", "unloading"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Dunzo: store → customer
    private fun extractDunzoLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("store", "pick up", "from", "merchant"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver at", "drop at", "customer", "to"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Quick commerce (Blinkit/Zepto/BigBasket): dark store → customer
    private fun extractQuickCommerceLocations(lines: List<String>, text: String): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("store", "dark store", "warehouse", "pick up from"))
            ?: extractGenericLocations(lines).first
        val drop = extractAfterLabel(lines, listOf("deliver to", "drop at", "customer", "address"))
            ?: extractGenericLocations(lines).second
        return pickup to drop
    }

    // Generic fallback: works for Loadshare, Shadowfax, Delhivery and unknown apps
    private fun extractGenericLocations(lines: List<String>): Pair<String, String> {
        val pickup = extractAfterLabel(lines, listOf("pickup", "pick up", "from", "collect", "origin"))
            ?: "N/A"
        val drop = extractAfterLabel(lines, listOf("drop", "deliver", "delivery", "to", "destination"))
            ?: "N/A"
        return pickup to drop
    }

    private fun extractAfterLabel(lines: List<String>, labels: List<String>): String? {
        for (i in lines.indices) {
            val line = lines[i].lowercase()
            if (labels.any { line.contains(it) }) {
                val nextLine = lines.getOrNull(i + 1)?.takeIf { it.isNotEmpty() && it.length > 2 }
                if (nextLine != null) return nextLine
                val inline = lines[i].substringAfter(":").trim()
                if (inline.length > 2) return inline
            }
        }
        return null
    }

    private fun extractDistance(text: String): String? {
        val pattern = Regex("""(\d+\.?\d*)\s*(km|kilometer|kilometers|kms|mi|miles)""", RegexOption.IGNORE_CASE)
        return pattern.find(text)?.value
    }

    private fun extractAmount(text: String): String? {
        val patterns = listOf(
            Regex("""₹\s*(\d+\.?\d*)"""),
            Regex("""Rs\.?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""(\d+\.?\d*)\s*₹"""),
            Regex("""earnings[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""payout[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE),
            Regex("""fare[:\s]+₹?\s*(\d+\.?\d*)""", RegexOption.IGNORE_CASE)
        )
        for (pattern in patterns) {
            val match = pattern.find(text)
            if (match != null) return match.value.trim()
        }
        return null
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
        if (settings.soundEnabled) playSound(settings.alertVolume)
        if (settings.overlayEnabled) showOverlay(alert, settings)
        sendNotification(alert)
        scope.launch { saveHistory(alert) }
        // Re-alert at 15s intervals so missed orders still get attention
        if (settings.repeatAlertCount > 0) {
            scope.launch {
                repeat(settings.repeatAlertCount) {
                    delay(15_000L)
                    if (settings.vibrationEnabled) vibrate()
                    if (settings.soundEnabled) playSound(settings.alertVolume)
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
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            manager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300, 150, 600), -1))
    }

    private fun playSound(volume: Float) {
        try {
            val maxVolume = (volume * ToneGenerator.MAX_VOLUME).toInt().coerceIn(1, ToneGenerator.MAX_VOLUME)
            val toneGen = ToneGenerator(AudioManager.STREAM_NOTIFICATION, maxVolume)
            toneGen.startTone(ToneGenerator.TONE_PROP_BEEP2, 800)
            Handler(Looper.getMainLooper()).postDelayed({ toneGen.release() }, 1000)
        } catch (_: Exception) {}
    }

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
