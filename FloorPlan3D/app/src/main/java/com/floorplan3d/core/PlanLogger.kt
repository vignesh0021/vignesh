package com.floorplan3d.core

import java.util.concurrent.ConcurrentLinkedDeque

/**
 * Logging abstraction used across the extraction/estimation pipeline.
 *
 * The pure-Kotlin domain layer must stay free of android.util.Log so it can run
 * in plain JVM unit tests; Android code installs [AndroidLogSink] at app start.
 */
interface PlanLogger {
    fun d(tag: String, message: String)
    fun w(tag: String, message: String)
    fun e(tag: String, message: String, throwable: Throwable? = null)
}

/** A single diagnostic entry kept for the in-app diagnostics panel. */
data class LogEntry(val timeMillis: Long, val level: Char, val tag: String, val message: String)

/**
 * Default logger: keeps a bounded in-memory ring buffer (surfaced in the app's
 * diagnostics panel) and forwards to an optional platform sink.
 */
object PlanLog : PlanLogger {
    private const val MAX_ENTRIES = 800

    /** Platform-specific sink (android.util.Log on device, stdout in tests). */
    @Volatile
    var sink: PlanLogger? = null

    private val buffer = ConcurrentLinkedDeque<LogEntry>()

    val entries: List<LogEntry>
        get() = buffer.toList()

    fun clear() = buffer.clear()

    private fun record(level: Char, tag: String, message: String) {
        buffer.addLast(LogEntry(System.currentTimeMillis(), level, tag, message))
        while (buffer.size > MAX_ENTRIES) buffer.pollFirst()
    }

    override fun d(tag: String, message: String) {
        record('D', tag, message)
        sink?.d(tag, message)
    }

    override fun w(tag: String, message: String) {
        record('W', tag, message)
        sink?.w(tag, message)
    }

    override fun e(tag: String, message: String, throwable: Throwable?) {
        record('E', tag, message + (throwable?.let { ": ${it.message}" } ?: ""))
        sink?.e(tag, message, throwable)
    }
}
