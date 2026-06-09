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
        private const val PROCESS_DEBOUNCE_MS = 300L
    }

    private var lastProcessTime = 0L

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

        val enabledKeywords = activeKeywords.filter { it.isEnabled }.map { it.text }
        if (enabledKeywords.isEmpty() && !alertManager.hasEnabledZones()) return

        val now = System.currentTimeMillis()
        if (now - lastProcessTime < PROCESS_DEBOUNCE_MS) return
        lastProcessTime = now

        val rootNode = rootInActiveWindow ?: return
        val extractedText = extractTextFromNode(rootNode)
        rootNode.recycle()

        if (extractedText.isBlank()) return

        serviceScope.launch(Dispatchers.Default) {
            alertManager.processScreenText(extractedText, enabledKeywords, currentSettings)
        }
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
