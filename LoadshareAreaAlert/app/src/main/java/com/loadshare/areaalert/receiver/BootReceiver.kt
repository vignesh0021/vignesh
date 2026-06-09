package com.loadshare.areaalert.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Accessibility service restarts automatically on boot when enabled by user.
        // No action needed — launching MainActivity on boot would be disruptive.
    }
}
