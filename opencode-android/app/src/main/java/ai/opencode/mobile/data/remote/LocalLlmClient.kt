package ai.opencode.mobile.data.remote

import android.content.Context
import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.util.Logger
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

/**
 * Runs a compressed model fully on-device via MediaPipe GenAI — no network, no API key.
 *
 * [ChatRequest.model] carries the absolute path to the `.task` model file. The heavy
 * [LlmInference] engine is created lazily and cached per model path; a fresh session is
 * created per turn. A mutex serializes access because the native runtime is single-threaded.
 *
 * v1 uses synchronous generation (the whole reply arrives at once, behind the typing
 * indicator) for reliability; token streaming can be layered on later.
 */
class LocalLlmClient(context: Context) : ChatClient {

    private val appContext = context.applicationContext
    private val mutex = Mutex()

    private var cachedPath: String? = null
    private var cached: LlmInference? = null

    override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = flow {
        try {
            val reply = mutex.withLock { runInference(request) }
            emit(ChatStreamEvent.Delta(reply.ifBlank { "(no response)" }))
            emit(ChatStreamEvent.Done)
        } catch (t: Throwable) {
            Logger.e("On-device inference failed", t)
            emit(ChatStreamEvent.Error(friendlyError(t)))
        }
    }.flowOn(Dispatchers.Default)

    private fun runInference(request: ChatRequest): String {
        val engine = engineFor(request.model)
        val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
            .setTopK(40)
            .setTopP(0.9f)
            .setTemperature(0.8f)
            .build()
        val session = LlmInferenceSession.createFromOptions(engine, sessionOptions)
        return try {
            session.addQueryChunk(buildPrompt(request))
            session.generateResponse()
        } finally {
            runCatching { session.close() }
        }
    }

    private fun engineFor(path: String): LlmInference {
        cached?.let { if (path == cachedPath) return it }
        runCatching { cached?.close() }
        cached = null
        cachedPath = null

        val file = File(path)
        check(file.exists() && file.length() > 0) {
            "Model file not found. Download or import a model in On-device models."
        }
        val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(path)
            .setMaxTokens(1024)
            .setMaxTopK(64)
            .build()
        val engine = LlmInference.createFromOptions(appContext, options)
        cached = engine
        cachedPath = path
        return engine
    }

    /** Gemma-style chat template; works reasonably across current LiteRT instruct models. */
    private fun buildPrompt(request: ChatRequest): String {
        val sb = StringBuilder()
        if (request.systemPrompt.isNotBlank()) {
            sb.append(request.systemPrompt).append("\n\n")
        }
        request.messages.forEach { turn ->
            val role = if (turn.role == Role.USER) "user" else "model"
            sb.append("<start_of_turn>").append(role).append('\n')
                .append(turn.content).append("<end_of_turn>\n")
        }
        sb.append("<start_of_turn>model\n")
        return sb.toString()
    }

    private fun friendlyError(t: Throwable): String {
        val msg = t.message ?: "Unknown error"
        return when {
            "not found" in msg.lowercase() -> msg
            "memory" in msg.lowercase() || t is OutOfMemoryError ->
                "Not enough memory to run this model. Try a smaller (int4/0.5B) model."
            else -> "On-device model error: $msg"
        }
    }
}
