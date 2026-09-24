package ai.opencode.mobile.data.local

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

/**
 * A compressed (quantized) model that can be run fully on-device via MediaPipe. These are
 * int4/int8 `.task` files from Google's LiteRT community — small enough for a phone.
 */
data class LocalModelInfo(
    val id: String,
    val name: String,
    val fileName: String,
    val url: String,
    val approxSizeMb: Int,
    val description: String,
    /** Some Hugging Face repos are gated and need a free access token to download. */
    val needsToken: Boolean = false,
)

/** A model file present on the device (from the catalog, a URL, or an imported file). */
data class InstalledModel(val name: String, val path: String, val sizeBytes: Long)

/** Progress of a model download. */
sealed interface DownloadProgress {
    data class Running(val downloadedBytes: Long, val totalBytes: Long) : DownloadProgress {
        val fraction: Float get() = if (totalBytes > 0) (downloadedBytes.toFloat() / totalBytes) else 0f
    }
    data class Done(val path: String) : DownloadProgress
    data class Failed(val message: String) : DownloadProgress
}

/**
 * Manages compressed on-device models: a small curated catalog, downloads with progress,
 * importing a user-provided `.task` file, and deletion. Files live in the app's private
 * storage so no extra permissions are needed.
 */
class LocalModelManager(context: Context) {

    private val appContext = context.applicationContext
    private val dir: File = File(appContext.filesDir, "models").apply { mkdirs() }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun catalog(): List<LocalModelInfo> = CATALOG

    fun fileFor(info: LocalModelInfo): File = File(dir, info.fileName)

    fun isInstalled(info: LocalModelInfo): Boolean = fileFor(info).let { it.exists() && it.length() > 0 }

    /** All `.task`/`.bin`/`.litertlm` model files currently on the device. */
    fun installed(): List<InstalledModel> =
        dir.listFiles()?.filter { it.isFile && it.length() > 0 }
            ?.sortedBy { it.name }
            ?.map { InstalledModel(name = it.name, path = it.absolutePath, sizeBytes = it.length()) }
            ?: emptyList()

    suspend fun delete(path: String): Boolean = withContext(Dispatchers.IO) {
        runCatching { File(path).takeIf { it.exists() }?.delete() ?: false }.getOrDefault(false)
    }

    /**
     * Streams a model from [url] into [fileName] under app storage, emitting progress. A
     * partial file (`.part`) is used so an interrupted download never looks complete.
     */
    fun download(url: String, fileName: String, token: String?): Flow<DownloadProgress> = flow {
        val dest = File(dir, fileName)
        val part = File(dir, "$fileName.part")
        val builder = Request.Builder().url(url)
        if (!token.isNullOrBlank()) builder.addHeader("Authorization", "Bearer ${token.trim()}")

        val response = http.newCall(builder.build()).execute()
        response.use {
            if (!response.isSuccessful) {
                emit(DownloadProgress.Failed("Download failed: HTTP ${response.code}. The model may be gated — add an access token."))
                return@use
            }
            val body = response.body ?: run {
                emit(DownloadProgress.Failed("Empty response from server."))
                return@use
            }
            val total = body.contentLength()
            var downloaded = 0L
            var lastEmit = 0L
            body.byteStream().use { input ->
                FileOutputStream(part).use { output ->
                    val buffer = ByteArray(1 shl 16)
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        downloaded += read
                        // Throttle UI updates to ~ every 2 MB.
                        if (downloaded - lastEmit > 2_000_000L) {
                            lastEmit = downloaded
                            emit(DownloadProgress.Running(downloaded, total))
                        }
                    }
                }
            }
            if (part.renameTo(dest)) {
                emit(DownloadProgress.Done(dest.absolutePath))
            } else {
                emit(DownloadProgress.Failed("Could not finalize the downloaded file."))
            }
        }
    }.flowOn(Dispatchers.IO)

    /** Copies a user-picked model file (via the system file picker) into app storage. */
    suspend fun import(uri: Uri): InstalledModel = withContext(Dispatchers.IO) {
        val safeName = resolveDisplayName(uri)
        val dest = File(dir, safeName)
        appContext.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(dest).use { output -> input.copyTo(output, bufferSize = 1 shl 16) }
        } ?: error("Could not open the selected file.")
        InstalledModel(name = dest.name, path = dest.absolutePath, sizeBytes = dest.length())
    }

    private fun resolveDisplayName(uri: Uri): String {
        val fromResolver = runCatching {
            appContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (idx >= 0 && cursor.moveToFirst()) cursor.getString(idx) else null
            }
        }.getOrNull()
        val name = (fromResolver ?: uri.lastPathSegment ?: "model-${System.currentTimeMillis()}.task")
            .substringAfterLast('/')
        return name.ifBlank { "model-${System.currentTimeMillis()}.task" }
    }

    companion object {
        // Curated compressed on-device models. URLs point at Google's LiteRT community repos.
        // If a repo is gated, the user adds a free Hugging Face token; importing a file always works.
        private val CATALOG = listOf(
            LocalModelInfo(
                id = "gemma3-1b-it-int4",
                name = "Gemma 3 1B Instruct (int4)",
                fileName = "gemma3-1b-it-int4.task",
                url = "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.task",
                approxSizeMb = 555,
                description = "Google's smallest Gemma 3, 4-bit quantized. Fast on most phones.",
                needsToken = true,
            ),
            LocalModelInfo(
                id = "qwen2.5-0.5b-it-q8",
                name = "Qwen2.5 0.5B Instruct (int8)",
                fileName = "qwen2.5-0.5b-instruct-q8.task",
                url = "https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/qwen2.5-0.5b-instruct-q8_seq128_ekv1280.task",
                approxSizeMb = 530,
                description = "Tiny, capable instruct model. Good for low-RAM devices.",
                needsToken = true,
            ),
        )
    }
}
