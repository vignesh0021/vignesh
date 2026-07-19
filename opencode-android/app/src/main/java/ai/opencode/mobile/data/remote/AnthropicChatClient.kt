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

/** Streams from Anthropic's `/v1/messages` SSE endpoint. */
class AnthropicChatClient(
    private val client: OkHttpClient,
    private val json: Json,
) : ChatClient {

    override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = callbackFlow {
        val body = AnthropicRequestDto(
            model = request.model,
            maxTokens = request.maxTokens,
            system = request.systemPrompt,
            messages = request.messages.map {
                WireChatMessageDto(
                    role = if (it.role == Role.USER) "user" else "assistant",
                    content = it.content,
                )
            },
        )
        val httpRequest = Request.Builder()
            .url(request.baseUrl.trimEnd('/') + "/v1/messages")
            .addHeader("x-api-key", request.apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .addHeader("content-type", "application/json")
            .post(json.encodeToString(AnthropicRequestDto.serializer(), body).toRequestBody(JSON_MEDIA))
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(source: EventSource, id: String?, type: String?, data: String) {
                if (data.isBlank()) return
                runCatching {
                    val event = json.decodeFromString(AnthropicDeltaEvent.serializer(), data)
                    when (event.type) {
                        "content_block_delta" -> event.delta?.text?.let { text ->
                            trySend(ChatStreamEvent.Delta(text))
                        }
                        "message_stop" -> {
                            trySend(ChatStreamEvent.Done)
                            close()
                        }
                    }
                }.onFailure { Logger.w("Anthropic delta parse failed", it) }
            }

            override fun onClosed(source: EventSource) {
                trySend(ChatStreamEvent.Done)
                close()
            }

            override fun onFailure(source: EventSource, t: Throwable?, response: Response?) {
                val message = parseError(response, t, json)
                trySend(ChatStreamEvent.Error(message))
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
