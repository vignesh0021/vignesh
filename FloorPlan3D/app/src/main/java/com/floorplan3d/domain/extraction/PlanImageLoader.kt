package com.floorplan3d.domain.extraction

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.exifinterface.media.ExifInterface
import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.math.max
import kotlin.math.min

/** Raised for anything the user should see as "this file could not be read as a plan". */
class PlanImageException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Loads a plan source (PDF / PNG / JPG, from SAF or camera capture) into a
 * working [Bitmap], handling:
 *  - content-URI copy into app storage (needed for PdfRenderer and re-processing)
 *  - PDF rasterisation of the first page at a crisp DPI
 *  - EXIF rotation from camera captures
 *  - downscaling giant scans to a bounded working size
 *  - corrupted / unsupported input with clear error messages
 */
class PlanImageLoader(
    private val context: Context,
    private val log: PlanLogger = PlanLog,
) {

    data class LoadedPlanImage(val bitmap: Bitmap, val localCopy: File)

    @Throws(PlanImageException::class)
    fun load(uri: Uri): LoadedPlanImage {
        val mime = context.contentResolver.getType(uri) ?: guessMimeFromName(uri)
        log.d(TAG, "Loading plan source $uri (mime=$mime)")

        val local = copyToLocal(uri, mime)
        val bitmap = try {
            if (mime == "application/pdf" || local.extension.equals("pdf", true)) {
                renderPdfFirstPage(local)
            } else {
                decodeBitmap(local)
            }
        } catch (e: PlanImageException) {
            throw e
        } catch (e: Exception) {
            log.e(TAG, "Failed to decode ${local.name}", e)
            throw PlanImageException("The file could not be read. It may be corrupted or in an unsupported format.", e)
        }

        if (bitmap.width < MIN_USABLE_PX || bitmap.height < MIN_USABLE_PX) {
            throw PlanImageException(
                "Image is too small (${bitmap.width}×${bitmap.height}). " +
                    "Please provide a scan of at least $MIN_USABLE_PX px on each side."
            )
        }
        return LoadedPlanImage(bitmap, local)
    }

    private fun copyToLocal(uri: Uri, mime: String?): File {
        val dir = File(context.filesDir, "plans").apply { mkdirs() }
        val ext = when {
            mime == "application/pdf" -> "pdf"
            mime == "image/png" -> "png"
            else -> "jpg"
        }
        val out = File(dir, "plan_${System.currentTimeMillis()}.$ext")
        try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(out).use { output -> input.copyTo(output) }
            } ?: throw IOException("Content resolver returned no stream")
        } catch (e: Exception) {
            log.e(TAG, "Failed to copy $uri", e)
            throw PlanImageException("The selected file could not be opened.", e)
        }
        if (out.length() == 0L) throw PlanImageException("The selected file is empty.")
        if (out.length() > MAX_FILE_BYTES) {
            out.delete()
            throw PlanImageException("File is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.")
        }
        return out
    }

    private fun renderPdfFirstPage(file: File): Bitmap {
        try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                PdfRenderer(pfd).use { renderer ->
                    if (renderer.pageCount == 0) throw PlanImageException("The PDF has no pages.")
                    renderer.openPage(0).use { page ->
                        // Render at up to ~200 DPI equivalent, bounded by MAX_WORKING_PX.
                        val scale = min(
                            MAX_WORKING_PX.toFloat() / max(page.width, page.height),
                            200f / 72f,
                        )
                        val w = max(1, (page.width * scale).toInt())
                        val h = max(1, (page.height * scale).toInt())
                        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        Canvas(bmp).drawColor(Color.WHITE) // PDFs may have transparent bg
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        log.d(TAG, "Rendered PDF page 1 of ${renderer.pageCount} at ${w}x$h")
                        return bmp
                    }
                }
            }
        } catch (e: SecurityException) {
            throw PlanImageException("The PDF is password-protected and cannot be opened.", e)
        } catch (e: PlanImageException) {
            throw e
        } catch (e: Exception) {
            throw PlanImageException("The PDF could not be rendered. It may be corrupted.", e)
        }
    }

    private fun decodeBitmap(file: File): Bitmap {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, opts)
        if (opts.outWidth <= 0 || opts.outHeight <= 0) {
            throw PlanImageException("The image could not be decoded. It may be corrupted.")
        }
        var sample = 1
        while (max(opts.outWidth, opts.outHeight) / (sample * 2) >= MAX_WORKING_PX) sample *= 2

        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        var bmp = BitmapFactory.decodeFile(file.absolutePath, decodeOpts)
            ?: throw PlanImageException("The image could not be decoded. It may be corrupted.")

        // Respect camera orientation.
        val rotation = try {
            when (ExifInterface(file.absolutePath).getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (e: Exception) { 0f }
        if (rotation != 0f) {
            val m = Matrix().apply { postRotate(rotation) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            log.d(TAG, "Applied EXIF rotation of $rotation°")
        }
        log.d(TAG, "Decoded image ${bmp.width}x${bmp.height} (sample=$sample)")
        return bmp
    }

    private fun guessMimeFromName(uri: Uri): String? = when {
        uri.toString().endsWith(".pdf", true) -> "application/pdf"
        uri.toString().endsWith(".png", true) -> "image/png"
        uri.toString().endsWith(".jpg", true) || uri.toString().endsWith(".jpeg", true) -> "image/jpeg"
        else -> null
    }

    companion object {
        private const val TAG = "PlanImageLoader"
        const val MAX_WORKING_PX = 2400
        const val MIN_USABLE_PX = 200
        const val MAX_FILE_BYTES = 50L * 1024 * 1024
    }
}
