package com.loadshare.areaalert.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.app.NotificationCompat
import com.loadshare.areaalert.MainActivity
import com.loadshare.areaalert.R
import com.loadshare.areaalert.alert.AlertManager
import com.loadshare.areaalert.data.SettingsRepository
import com.loadshare.areaalert.model.AppSettings
import com.loadshare.areaalert.model.Keyword
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import java.util.Calendar
import javax.inject.Inject

@AndroidEntryPoint
class AccessibilityMonitorService : AccessibilityService() {

    @Inject lateinit var alertManager: AlertManager
    @Inject lateinit var settingsRepository: SettingsRepository

    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var currentSettings: AppSettings = AppSettings()
    private var activeKeywords: List<Keyword> = emptyList()

    companion object {
        private const val FOREGROUND_NOTIFICATION_ID = 1001
        private const val MONITORING_CHANNEL_ID = "loadshare_monitoring"
        private const val PROCESS_DEBOUNCE_MS = 1000L
        private const val AUTO_DISMISS_DEBOUNCE_MS = 500L
        // Separate debounce for list-card filtering — one card dismissed per interval,
        // then the list re-renders and the next event triggers the next dismissal.
        private const val ORDER_LIST_FILTER_DEBOUNCE_MS = 800L

        // These packages must never trigger alerts — system UI and our own app
        // cause feedback loops (notification text re-read as new order content)
        private val BLOCKED_PACKAGES = setOf(
            "android",
            "com.android.systemui",
            "com.android.launcher",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.samsung.android.launcher",
            "com.miui.home",
            "com.motorola.launcher3",
            "com.oneplus.launcher"
        )

        // Explicit titles that identify the "Orders Near You" list screen
        private val ORDER_LIST_SCREEN_SIGNALS = listOf(
            "orders near you", "available orders", "nearby orders"
        )

        // Patterns that indicate a single-order popup (not just background screen text)
        private val ORDER_POPUP_PATTERNS = listOf(
            "choose order", "accept order", "new order", "order request",
            "view more orders", "accept ride", "accept trip", "new delivery",
            "order details", "pick up order",
            // Loadshare / Shadowfax specific
            "accept", "decline", "new shipment", "order available",
            "view order", "assign order", "order alert", "new task",
            "delivery request", "shipment request"
        )
        private val AMOUNT_PATTERN = Regex("""₹\s*\d+""")
    }

    private var lastProcessTime = 0L
    private var lastAutoDismissCheck = 0L
    private var lastOrderListFilterTime = 0L

    override fun onCreate() {
        super.onCreate()
        postStatusNotification()
        observeSettings()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo?.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                    AccessibilityEvent.TYPE_VIEW_SCROLLED or
                    AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 100
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                    AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (!currentSettings.isMonitoringActive) return
        if (currentSettings.workingHoursEnabled && !isWithinWorkingHours()) return

        val packageName = event.packageName?.toString() ?: ""
        // Block our own app and system UI — they create notification feedback loops
        if (packageName == applicationContext.packageName) return
        if (packageName in BLOCKED_PACKAGES) return

        val enabledKeywords = activeKeywords.filter { it.isEnabled }.map { it.text }

        val rootNode = rootInActiveWindow ?: return

        // ── Order list filtering ─────────────────────────────────────────────
        // Must run BEFORE the popup auto-dismiss block. The list screen also
        // contains × buttons, and the popup path would click the wrong one
        // (first × found regardless of card keyword) if it ran first.
        var processedAsListScreen = false
        if (currentSettings.autoDismissNonAreaOrders && enabledKeywords.isNotEmpty()) {
            val now = System.currentTimeMillis()
            if (now - lastOrderListFilterTime >= ORDER_LIST_FILTER_DEBOUNCE_MS) {
                val screenText = extractTextFromNode(rootNode)
                if (looksLikeOrderListScreen(screenText)) {
                    processedAsListScreen = true
                    lastOrderListFilterTime = now
                    val dismissed = findAndDismissNonAreaCard(rootNode, enabledKeywords)
                    if (dismissed) {
                        rootNode.recycle()
                        return  // one card gone; next accessibility event will remove the next
                    }
                    // All visible cards are preferred — fall through to normal alert processing
                }
            }
        }

        // ── Popup auto-dismiss ───────────────────────────────────────────────
        // Runs on ALL event types because Loadshare shows order popups as
        // content updates within an existing window (TYPE_WINDOW_CONTENT_CHANGED),
        // not as new window events. Skipped when we already identified a list screen
        // above to avoid interfering with list card interactions.
        if (!processedAsListScreen && currentSettings.autoDismissNonAreaOrders && enabledKeywords.isNotEmpty()) {
            val now = System.currentTimeMillis()
            if (now - lastAutoDismissCheck >= AUTO_DISMISS_DEBOUNCE_MS) {
                lastAutoDismissCheck = now
                val fullText = extractTextFromNode(rootNode)
                // Check the FULL text so we never dismiss a preferred-area popup
                // whose keyword happens to appear on a long (>60-char) address line.
                // Short-line filtering is only used later in AlertManager to prevent
                // false-positive ALERTS from geocoded address strings.
                val hasKeyword = enabledKeywords.any { kw ->
                    fullText.contains(kw, ignoreCase = true)
                }
                if (!hasKeyword && looksLikeOrderPopup(fullText)) {
                    val dismissed = findAndClickDismiss(rootNode)
                    if (!dismissed) {
                        // Close button not found in accessibility tree (ImageButton with no
                        // text/description). ACTION_DISMISS works for standard dialogs;
                        // GLOBAL_ACTION_BACK closes bottom sheets without exiting the app.
                        val dimissedByAction = rootNode.performAction(AccessibilityNodeInfo.ACTION_DISMISS)
                        if (!dimissedByAction) {
                            performGlobalAction(GLOBAL_ACTION_BACK)
                        }
                    }
                    rootNode.recycle()
                    return
                }
            }
        }

        if (enabledKeywords.isEmpty() && !alertManager.hasEnabledZones()) {
            rootNode.recycle()
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastProcessTime < PROCESS_DEBOUNCE_MS) {
            rootNode.recycle()
            return
        }
        lastProcessTime = now

        val extractedText = extractTextFromNode(rootNode)
        rootNode.recycle()

        if (extractedText.isBlank()) return

        serviceScope.launch(Dispatchers.Default) {
            alertManager.processScreenText(extractedText, enabledKeywords, currentSettings, packageName)
        }
    }

    private fun isWithinWorkingHours(): Boolean {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val start = currentSettings.workStartHour
        val end = currentSettings.workEndHour
        return if (start <= end) hour >= start && hour < end else hour >= start || hour < end
    }

    // Returns true when the screen shows a LIST of order cards (e.g. "Orders Near You").
    // This is distinct from a single-order popup — list screens show multiple ₹ amounts
    // and per-card × buttons that skip individual orders.
    private fun looksLikeOrderListScreen(text: String): Boolean {
        val lower = text.lowercase()
        if (ORDER_LIST_SCREEN_SIGNALS.any { lower.contains(it) }) return true
        // Generic fallback: 2+ amounts AND "choose order" = list, not a single-order popup
        val multipleAmounts = AMOUNT_PATTERN.findAll(text).count() >= 2
        return multipleAmounts && lower.contains("choose order")
    }

    // Returns true if the visible screen looks like a single delivery order popup.
    // Two detection paths so we catch apps whose UI wording we haven't seen yet:
    //   Path A: ₹ amount + one of our known order-prompt patterns
    //   Path B: ₹ amount + both a pickup label AND a drop label (UI-agnostic)
    private fun looksLikeOrderPopup(text: String): Boolean {
        val lower = text.lowercase()
        val hasAmount = AMOUNT_PATTERN.containsMatchIn(text)
        if (!hasAmount) return false
        val hasOrderPrompt = ORDER_POPUP_PATTERNS.any { lower.contains(it) }
        if (hasOrderPrompt) return true
        // Path B: any screen showing an amount alongside pickup + drop/deliver labels
        val hasPickup = lower.contains("pick") || lower.contains("from") || lower.contains("origin")
        val hasDrop = lower.contains("drop") || lower.contains("deliver") || lower.contains("destination")
        return hasPickup && hasDrop
    }

    // Recursively finds the FIRST order card whose × button can be clicked and whose
    // text does NOT contain any preferred keyword, then clicks it.
    // One card dismissed per call — the list re-renders, firing a new accessibility event
    // that will process the next non-preferred card.
    private fun findAndDismissNonAreaCard(
        node: AccessibilityNodeInfo,
        keywords: List<String>,
        depth: Int = 0
    ): Boolean {
        if (depth > 30) return false

        val text = node.text?.toString()?.trim() ?: ""
        val desc = node.contentDescription?.toString()?.trim()?.lowercase() ?: ""

        val isCloseIndicator = text in setOf("×", "✕", "✗", "✖", "✘") ||
                desc.contains("skip") || desc.contains("decline") ||
                desc.contains("close") || desc.contains("dismiss")

        if (isCloseIndicator) {
            val cardText = extractCardText(node)
            val hasKeyword = keywords.any { kw -> cardText.contains(kw, ignoreCase = true) }
            if (!hasKeyword) {
                if (node.isClickable) {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    return true
                }
                // Same parent-climb pattern as findAndClickDismiss
                var parent = node.parent
                var climbs = 0
                while (parent != null && climbs < 3) {
                    if (parent.isClickable) {
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        parent.recycle()
                        return true
                    }
                    val gp = parent.parent
                    parent.recycle()
                    parent = gp
                    climbs++
                }
                parent?.recycle()
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findAndDismissNonAreaCard(child, keywords, depth + 1)
            child.recycle()
            if (found) return true
        }
        return false
    }

    // Walks UP from a × button node to find the enclosing order card container —
    // the first ancestor with ≥ 3 children (indicating a multi-field card ViewGroup).
    // Returns all text found within that card.
    private fun extractCardText(closeNode: AccessibilityNodeInfo): String {
        var current = closeNode.parent ?: return ""
        var climbs = 0
        while (climbs < 6) {
            if (current.childCount >= 3) {
                val sb = StringBuilder()
                extractTextRecursive(current, sb, 0)
                current.recycle()
                return sb.toString()
            }
            val parent = current.parent
            current.recycle()
            if (parent == null) return ""
            current = parent
            climbs++
        }
        current.recycle()
        return ""
    }

    // Recursively finds the close/dismiss button and clicks it.
    // Strategy 1: match by text character or content description.
    // Strategy 2: if the matching node itself is not clickable (common for ImageView icons
    //             inside a FrameLayout button), climb up to the nearest clickable ancestor.
    private fun findAndClickDismiss(node: AccessibilityNodeInfo, depth: Int = 0): Boolean {
        if (depth > 25) return false

        val text = node.text?.toString()?.trim() ?: ""
        val desc = node.contentDescription?.toString()?.trim()?.lowercase() ?: ""

        val isCloseIndicator = text in setOf("×", "✕", "✗", "✖", "✘", "X", "x") ||
                desc.contains("close") || desc.contains("dismiss") ||
                desc.contains("cancel") || desc.contains("decline") ||
                desc.contains("skip") || desc.contains("reject")

        if (isCloseIndicator) {
            if (node.isClickable) {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return true
            }
            // The icon/text is not clickable itself — the parent container usually is.
            // Walk up at most 3 levels to find the clickable ancestor.
            var parent = node.parent
            var climbs = 0
            while (parent != null && climbs < 3) {
                if (parent.isClickable) {
                    parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    parent.recycle()
                    return true
                }
                val grandParent = parent.parent
                parent.recycle()
                parent = grandParent
                climbs++
            }
            parent?.recycle()
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findAndClickDismiss(child, depth + 1)
            child.recycle()
            if (found) return true
        }
        return false
    }

    private fun extractTextFromNode(node: AccessibilityNodeInfo): String {
        val builder = StringBuilder()
        extractTextRecursive(node, builder, 0)
        return builder.toString()
    }

    private fun extractTextRecursive(
        node: AccessibilityNodeInfo,
        builder: StringBuilder,
        depth: Int
    ) {
        if (depth > 20) return

        val text = node.text?.toString()
        val contentDesc = node.contentDescription?.toString()

        if (!text.isNullOrBlank()) {
            builder.append(text).append("\n")
        } else if (!contentDesc.isNullOrBlank()) {
            builder.append(contentDesc).append("\n")
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            extractTextRecursive(child, builder, depth + 1)
            child.recycle()
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(FOREGROUND_NOTIFICATION_ID)
    }

    private fun observeSettings() {
        serviceScope.launch {
            settingsRepository.appSettings.combine(settingsRepository.keywords) { settings, keywords ->
                Pair(settings, keywords)
            }.collect { (settings, keywords) ->
                currentSettings = settings
                activeKeywords = keywords
            }
        }
    }

    private fun postStatusNotification() {
        val channel = NotificationChannel(
            MONITORING_CHANNEL_ID,
            "Order Monitoring",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when Loadshare Area Alert is running"
            setShowBadge(false)
        }
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)

        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, MONITORING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Loadshare Area Alert")
            .setContentText("Accessibility service active — monitoring orders")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

        manager.notify(FOREGROUND_NOTIFICATION_ID, notification)
    }
}
