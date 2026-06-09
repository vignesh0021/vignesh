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
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class OverlayService : Service() {

    companion object {
        const val EXTRA_PLATFORM = "extra_platform"
        const val EXTRA_MATCHED_KEYWORD = "extra_matched_keyword"
        const val EXTRA_PICKUP = "extra_pickup"
        const val EXTRA_DROP = "extra_drop"
        const val EXTRA_DISTANCE = "extra_distance"
        const val EXTRA_AMOUNT = "extra_amount"
        private const val AUTO_DISMISS_MS = 8000L
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

        showOverlay(platform, keyword, pickup, drop, distance, amount)
        return START_NOT_STICKY
    }

    private fun showOverlay(
        platform: String,
        keyword: String,
        pickup: String,
        drop: String,
        distance: String,
        amount: String
    ) {
        dismissCurrentOverlay()

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 120
        }

        val view = createOverlayView(platform, keyword, pickup, drop, distance, amount)
        overlayView = view

        view.setOnClickListener { dismissCurrentOverlay() }

        try {
            windowManager?.addView(view, params)
        } catch (e: Exception) {
            stopSelf()
            return
        }

        dismissRunnable = Runnable { dismissCurrentOverlay() }
        handler.postDelayed(dismissRunnable!!, AUTO_DISMISS_MS)
    }

    private fun createOverlayView(
        platform: String,
        keyword: String,
        pickup: String,
        drop: String,
        distance: String,
        amount: String
    ): View {
        val inflater = LayoutInflater.from(this)
        val view = inflater.inflate(R.layout.overlay_alert, null)

        view.findViewById<TextView>(R.id.tv_title).text = "$platform · Order Found"
        view.findViewById<TextView>(R.id.tv_keyword).text = "Area: $keyword"
        view.findViewById<TextView>(R.id.tv_pickup).text = "Pickup: $pickup"
        view.findViewById<TextView>(R.id.tv_drop).text = "Drop: $drop"
        view.findViewById<TextView>(R.id.tv_distance).text = "Distance: $distance"
        view.findViewById<TextView>(R.id.tv_amount).text = "Amount: $amount"
        view.findViewById<TextView>(R.id.tv_dismiss).setOnClickListener { dismissCurrentOverlay() }

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
