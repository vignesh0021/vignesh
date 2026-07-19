package ai.opencode.mobile.data.remote

import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.util.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Streams from any OpenAI-compatible `/v1/chat/completions` endpoint (OpenAI, OpenRouter,
 * Groq, custom gateways).
 *
 * We deliberately read the response by hand rather than via okhttp-sse: free gateways such
 * as OpenRouter frequently return an HTTP 200 whose body is a plain-JSON completion or an
 * inline `{"error":...}` object instead of a `text/event-stream`. A strict SSE reader
 * reports those as "Request failed (HTTP 200)"; here we detect the content type and fall
 * back to parsing the whole JSON body, surfacing the provider's real error message.
 */
class OpenAiChatClient(
    private val client: OkHttpClient,
    private val json: Json,
) : ChatClient {

    override fun streamChat(request: ChatRequest): Flow<ChatStreamEvent> = flow {
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
            .addHeader("Accept", "text/event-stream")
            // OpenRouter attribution headers; ignored by other OpenAI-compatible providers.
            .addHeader("HTTP-Referer", "https://github.com/vignesh0021/vignesh")
            .addHeader("X-Title", "OmniCode")
            .post(json.encodeToString(OpenAiRequestDto.serializer(), body).toRequestBody(JSON_MEDIA))
            .build()

        val response = client.newCall(httpRequest).execute()
        response.use {
            if (!response.isSuccessful) {
                emit(ChatStreamEvent.Error(parseError(response, null, json)))
                return@use
            }
            val responseBody = response.body ?: run {
                emit(ChatStreamEvent.Error("Empty response from provider."))
                return@use
            }
            val subtype = responseBody.contentType()?.subtype
            val source = responseBody.source()

            if (subtype == "event-stream") {
                var emittedAny = false
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    if (!line.startsWith("data:")) continue
                    val data = line.substringAfter("data:").trim()
                    if (data.isEmpty()) continue
                    if (data == "[DONE]") break
                    val delta = parseDelta(data)
                    if (!delta.isNullOrEmpty()) {
                        emittedAny = true
                        emit(ChatStreamEvent.Delta(delta))
                    } else {
                        // An error object can arrive mid-stream at HTTP 200.
                        errorMessageIn(data)?.let {
                            emit(ChatStreamEvent.Error(it))
                            return@use
                        }
                    }
                }
                if (!emittedAny) {
                    emit(ChatStreamEvent.Error("The model returned an empty response. Try another model."))
                } else {
                    emit(ChatStreamEvent.Done)
                }
            } else {
                // Non-streaming JSON body (a full completion, or a 200 error envelope).
                val text = source.readUtf8()
                val content = completionContentIn(text)
                val error = errorMessageIn(text)
                when {
                    !content.isNullOrEmpty() -> {
                        emit(ChatStreamEvent.Delta(content))
                        emit(ChatStreamEvent.Done)
                    }
                    !error.isNullOrBlank() -> emit(ChatStreamEvent.Error(error))
                    else -> emit(ChatStreamEvent.Error("Unexpected response from provider."))
                }
            }
        }
    }.catch { t ->
        Logger.w("OpenAI stream failed", t)
        emit(ChatStreamEvent.Error(t.message ?: "Network error — check your connection."))
    }.flowOn(Dispatchers.IO)

    /** Extracts the incremental token from a streaming `data:` chunk. */
    private fun parseDelta(data: String): String? = runCatching {
        json.decodeFromString(OpenAiStreamChunk.serializer(), data)
            .choices.firstOrNull()?.delta?.content
    }.getOrNull()

    /** Extracts assistant content from a full (non-streamed) completion JSON body. */
    private fun completionContentIn(text: String): String? = runCatching {
        json.parseToJsonElement(text).jsonObject["choices"]
            ?.jsonArray?.firstOrNull()?.jsonObject
            ?.get("message")?.jsonObject
            ?.get("content")?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    /** Extracts a provider error message from any JSON body that contains `error.message`. */
    private fun errorMessageIn(text: String): String? = runCatching {
        json.parseToJsonElement(text).jsonObject["error"]
            ?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    companion object {
        private val JSON_MEDIA = "application/json".toMediaType()
    }
}
