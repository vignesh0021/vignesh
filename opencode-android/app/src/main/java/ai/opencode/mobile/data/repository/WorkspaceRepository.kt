package ai.opencode.mobile.data.repository

import ai.opencode.mobile.util.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** A node in the project file tree shown by the Files screen. */
data class FileNode(
    val name: String,
    val absolutePath: String,
    val isDirectory: Boolean,
    val sizeBytes: Long,
)

/**
 * A sandboxed on-device "workspace" that backs the project/file-management feature. It
 * lives under the app's external files dir so no runtime storage permission is required,
 * and it is seeded with a sample project on first launch so the screen is never empty.
 */
class WorkspaceRepository(private val root: File) {

    init {
        if (!root.exists()) root.mkdirs()
    }

    val rootPath: String get() = root.absolutePath

    suspend fun ensureSeeded() = withContext(Dispatchers.IO) {
        val sample = File(root, "sample-project")
        if (!sample.exists()) {
            runCatching {
                sample.mkdirs()
                File(sample, "README.md").writeText(
                    """
                    # Sample Project

                    This project lives inside the OpenCode Mobile workspace. Open a file to
                    view it with syntax highlighting, edit it, or reference it in a chat.
                    """.trimIndent()
                )
                File(sample, "main.kt").writeText(
                    """
                    fun main() {
                        // Ask OpenCode to refactor or explain this.
                        val greeting = "Hello from OpenCode Mobile"
                        println(greeting)
                    }
                    """.trimIndent()
                )
            }.onFailure { Logger.w("Failed to seed sample project", it) }
        }
    }

    suspend fun list(dir: File = root): List<FileNode> = withContext(Dispatchers.IO) {
        val safe = resolveInside(dir.absolutePath) ?: root
        (safe.listFiles()?.toList() ?: emptyList())
            .sortedWith(compareByDescending<File> { it.isDirectory }.thenBy { it.name.lowercase() })
            .map { FileNode(it.name, it.absolutePath, it.isDirectory, it.length()) }
    }

    suspend fun readText(path: String): String = withContext(Dispatchers.IO) {
        val file = resolveInside(path) ?: return@withContext ""
        if (file.length() > MAX_READ_BYTES) {
            "// File too large to preview (${file.length()} bytes)."
        } else {
            runCatching { file.readText() }.getOrElse { "// Unable to read file: ${it.message}" }
        }
    }

    suspend fun writeText(path: String, content: String): Boolean = withContext(Dispatchers.IO) {
        val file = resolveInside(path) ?: return@withContext false
        runCatching { file.writeText(content); true }.getOrElse {
            Logger.w("writeText failed", it); false
        }
    }

    suspend fun createFile(parent: String, name: String): Boolean = withContext(Dispatchers.IO) {
        val dir = resolveInside(parent) ?: return@withContext false
        val target = File(dir, name.trim())
        runCatching { target.createNewFile() }.getOrDefault(false)
    }

    suspend fun createDir(parent: String, name: String): Boolean = withContext(Dispatchers.IO) {
        val dir = resolveInside(parent) ?: return@withContext false
        File(dir, name.trim()).mkdirs()
    }

    suspend fun delete(path: String): Boolean = withContext(Dispatchers.IO) {
        val file = resolveInside(path) ?: return@withContext false
        if (file == root) return@withContext false
        runCatching { file.deleteRecursively() }.getOrDefault(false)
    }

    fun parentWithinRoot(path: String): String? {
        val file = File(path)
        if (file.absolutePath == root.absolutePath) return null
        val parent = file.parentFile ?: return null
        return if (parent.absolutePath.startsWith(root.absolutePath)) parent.absolutePath else null
    }

    /** Guards against path traversal escaping the workspace root. */
    private fun resolveInside(path: String): File? {
        val candidate = File(path).canonicalFile
        val base = root.canonicalFile
        return if (candidate == base || candidate.path.startsWith(base.path + File.separator)) {
            candidate
        } else {
            Logger.w("Rejected path outside workspace: $path")
            null
        }
    }

    companion object {
        private const val MAX_READ_BYTES = 512 * 1024
    }
}
