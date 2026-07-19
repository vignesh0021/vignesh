package ai.opencode.mobile.data.remote

import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.util.Logger
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/** Streams from any OpenAI-compatible `/v1/chat/completions` SSE endpoint. */
class OpenAiChatClient(
    private val client: OkHttpClient,
    private val json: Json,
) : ChatClient {

    override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = callbackFlow {
        val wireMessages = buildList {
            if (request.systemPrompt.isNotBlank()) {
                add(WireChatMessageDto("system", request.systemPrompt))
            }
            request.messages.forEach {
                add(
                    WireChatMessageDto(
                        role = if (it.role == Role.USER) "user" else "assistant",
                        content = it.content,
                    )
                )
            }
        }
        val body = OpenAiRequestDto(model = request.model, messages = wireMessages)
        val httpRequest = Request.Builder()
            .url(request.baseUrl.trimEnd('/') + "/v1/chat/completions")
            .addHeader("Authorization", "Bearer ${request.apiKey}")
            .addHeader("content-type", "application/json")
            // OpenRouter attribution headers; ignored by other OpenAI-compatible providers.
            .addHeader("HTTP-Referer", "https://github.com/vignesh0021/vignesh")
            .addHeader("X-Title", "OpenCode Mobile")
            .post(json.encodeToString(OpenAiRequestDto.serializer(), body).toRequestBody(JSON_MEDIA))
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(source: EventSource, id: String?, type: String?, data: String) {
                if (data.isBlank()) return
                if (data.trim() == "[DONE]") {
                    trySend(ChatStreamEvent.Done)
                    close()
                    return
                }
                runCatching {
                    val chunk = json.decodeFromString(OpenAiStreamChunk.serializer(), data)
                    chunk.choices.firstOrNull()?.delta?.content?.let { text ->
                        if (text.isNotEmpty()) trySend(ChatStreamEvent.Delta(text))
                    }
                }.onFailure { Logger.w("OpenAI delta parse failed", it) }
            }

            override fun onClosed(source: EventSource) {
                trySend(ChatStreamEvent.Done)
                close()
            }

            override fun onFailure(source: EventSource, t: Throwable?, response: Response?) {
                trySend(ChatStreamEvent.Error(parseError(response, t, json)))
                close()
            }
        }

        val eventSource = EventSources.createFactory(client).newEventSource(httpRequest, listener)
        awaitClose { eventSource.cancel() }
    }

    companion object {
        private val JSON_MEDIA = "application/json".toMediaType()
    }
}
