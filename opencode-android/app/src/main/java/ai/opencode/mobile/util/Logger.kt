package ai.opencode.mobile.util

import android.util.Log
import ai.opencode.mobile.BuildConfig

/**
 * Thin logging facade so the rest of the app never touches [Log] directly. Debug logs
 * are compiled out of release builds; warnings and errors are always retained so crash
 * triage still works in production.
 */
object Logger {
    private const val TAG = "OpenCode"

    fun d(message: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, message)
    }

    fun i(message: String) = Log.i(TAG, message).let { }

    fun w(message: String, t: Throwable? = null) {
        Log.w(TAG, message, t)
    }

    fun e(message: String, t: Throwable? = null) {
        Log.e(TAG, message, t)
    }
}
