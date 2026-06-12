package com.loadshare.areaalert.service

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.*
import android.widget.TextView
import com.loadshare.areaalert.R
import com.loadshare.areaalert.alert.AlertManager
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class OverlayService : Service() {

    @Inject lateinit var alertManager: AlertManager

    companion object {
        const val EXTRA_PLATFORM = "extra_platform"
        const val EXTRA_MATCHED_KEYWORD = "extra_matched_keyword"
        const val EXTRA_PICKUP = "extra_pickup"
        const val EXTRA_DROP = "extra_drop"
        const val EXTRA_DISTANCE = "extra_distance"
        const val EXTRA_AMOUNT = "extra_amount"
        const val EXTRA_PACKAGE_NAME = "extra_package_name"
        const val EXTRA_DURATION_MS = "extra_duration_ms"
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private val handler = Handler(Looper.getMainLooper())
    private var dismissRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent ?: return START_NOT_STICKY

        val platform = intent.getStringExtra(EXTRA_PLATFORM) ?: "Delivery App"
        val keyword = intent.getStringExtra(EXTRA_MATCHED_KEYWORD) ?: return START_NOT_STICKY
        val pickup = intent.getStringExtra(EXTRA_PICKUP) ?: "N/A"
        val drop = intent.getStringExtra(EXTRA_DROP) ?: "N/A"
        val distance = intent.getStringExtra(EXTRA_DISTANCE) ?: "N/A"
        val amount = intent.getStringExtra(EXTRA_AMOUNT) ?: "N/A"
        val appPackage = intent.getStringExtra(EXTRA_PACKAGE_NAME) ?: ""
        val durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 15_000L)

        showOverlay(platform, keyword, pickup, drop, distance, amount, appPackage, durationMs)
        return START_NOT_STICKY
    }

    private fun showOverlay(
        platform: String,
        keyword: String,
        pickup: String,
        drop: String,
        distance: String,
        amount: String,
        appPackage: String,
        durationMs: Long
    ) {
        dismissCurrentOverlay()

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 100
        }

        val view = createOverlayView(platform, keyword, pickup, drop, distance, amount, appPackage)
        overlayView = view

        try {
            windowManager?.addView(view, params)
        } catch (e: Exception) {
            stopSelf()
            return
        }

        // 0 = manual dismiss only — never auto-close
        if (durationMs > 0) {
            dismissRunnable = Runnable { dismissCurrentOverlay() }
            handler.postDelayed(dismissRunnable!!, durationMs)
        }
    }

    private fun createOverlayView(
        platform: String,
        keyword: String,
        pickup: String,
        drop: String,
        distance: String,
        amount: String,
        appPackage: String
    ): View {
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.overlay_alert, null)

        view.findViewById<TextView>(R.id.tv_title).text = "$platform · YOUR AREA ORDER!"
        view.findViewById<TextView>(R.id.tv_keyword).text = "Area: $keyword"
        view.findViewById<TextView>(R.id.tv_pickup).text =
            if (pickup != "N/A") "Pickup: $pickup" else ""
        view.findViewById<TextView>(R.id.tv_drop).text =
            if (drop != "N/A") "Drop: $drop" else ""
        view.findViewById<TextView>(R.id.tv_distance).text =
            if (distance != "N/A") distance else ""
        view.findViewById<TextView>(R.id.tv_amount).text = amount
        view.findViewById<TextView>(R.id.tv_dismiss).setOnClickListener { dismissCurrentOverlay() }

        view.findViewById<TextView>(R.id.btn_snooze).setOnClickListener {
            alertManager.snoozeFor(10 * 60 * 1000L)
            dismissCurrentOverlay()
        }

        val btnOpenApp = view.findViewById<TextView>(R.id.btn_open_app)
        if (appPackage.isNotEmpty() && appPackage != packageName) {
            val launchIntent = packageManager.getLaunchIntentForPackage(appPackage)
            if (launchIntent != null) {
                btnOpenApp.text = "TAP TO OPEN $platform →"
                btnOpenApp.setOnClickListener {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(launchIntent)
                    dismissCurrentOverlay()
                }
            } else {
                btnOpenApp.text = "DISMISS"
                btnOpenApp.setOnClickListener { dismissCurrentOverlay() }
            }
        } else {
            btnOpenApp.text = "DISMISS"
            btnOpenApp.setOnClickListener { dismissCurrentOverlay() }
        }

        return view
    }

    private fun dismissCurrentOverlay() {
        dismissRunnable?.let { handler.removeCallbacks(it) }
        dismissRunnable = null
        overlayView?.let {
            try {
                windowManager?.removeView(it)
            } catch (_: Exception) {
            }
        }
        overlayView = null
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        dismissCurrentOverlay()
    }
}
