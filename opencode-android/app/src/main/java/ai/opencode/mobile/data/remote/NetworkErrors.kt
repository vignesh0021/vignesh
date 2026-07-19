package ai.opencode.mobile.data.remote

import kotlinx.serialization.json.Json
import okhttp3.Response
import java.io.IOException

/**
 * Turns a failed SSE connection into a human-readable message. We try to surface the
 * provider's structured error body first, then fall back to HTTP status, then to the
 * throwable — whichever is most informative for the user.
 */
fun parseError(response: Response?, t: Throwable?, json: Json): String {
    val bodyText = try {
        response?.body?.string()
    } catch (_: IOException) {
        null
    }

    if (!bodyText.isNullOrBlank()) {
        val structured = runCatching {
            json.decodeFromString(ApiErrorEnvelope.serializer(), bodyText).error?.message
        }.getOrNull()
        if (!structured.isNullOrBlank()) return structured
    }

    response?.let {
        val reason = when (it.code) {
            401 -> "Unauthorized — check your API key in Settings."
            403 -> "Forbidden — your key may not have access to this model."
            404 -> "Endpoint not found — verify the Base URL in Settings."
            429 -> "Rate limited — please wait and try again."
            in 500..599 -> "The provider is having issues (HTTP ${it.code})."
            else -> "Request failed (HTTP ${it.code})."
        }
        return reason
    }

    return t?.message?.takeIf { it.isNotBlank() }
        ?: "Network error — check your connection and try again."
}
