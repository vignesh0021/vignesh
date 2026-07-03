package com.floorplan3d.domain.extraction

import android.graphics.Bitmap
import android.net.Uri
import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.domain.model.FloorPlan
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.File

/** Progress stages surfaced in the UI while a plan is processed. */
enum class ExtractionStage(val label: String) {
    LOADING("Reading plan image…"),
    OCR("Reading annotations (OCR)…"),
    GEOMETRY("Detecting walls…"),
    ASSEMBLING("Building 3D model…"),
}

data class ExtractionOutput(
    val plan: FloorPlan,
    val sourceImage: File,
    val previewBitmap: Bitmap,
)

/**
 * End-to-end extraction: source URI → decoded bitmap → (OCR ∥ wall detection)
 * → scaled [FloorPlan].
 *
 * OCR failures degrade gracefully: the geometry path still produces a model,
 * with a warning that annotations could not be read.
 */
class PlanExtractionPipeline(
    private val imageLoader: PlanImageLoader,
    private val annotationParser: AnnotationParser = AnnotationParser(),
    private val wallDetector: WallDetector = WallDetector(),
    private val buildingAssembler: BuildingAssembler = BuildingAssembler(),
    private val log: PlanLogger = PlanLog,
) {

    suspend fun extract(
        uri: Uri,
        planName: String,
        onStage: (ExtractionStage) -> Unit = {},
    ): ExtractionOutput = withContext(Dispatchers.Default) {
        val startedAt = System.currentTimeMillis()

        onStage(ExtractionStage.LOADING)
        val loaded = imageLoader.load(uri)
        val bitmap = loaded.bitmap

        onStage(ExtractionStage.OCR)
        val ocrLines = runOcr(bitmap)

        onStage(ExtractionStage.GEOMETRY)
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val detections = wallDetector.detectAll(pixels, bitmap.width, bitmap.height)

        onStage(ExtractionStage.ASSEMBLING)
        val annotations = annotationParser.parse(ocrLines)
        val plan = buildingAssembler.assemble(planName, detections, annotations)

        log.d(TAG, "Extraction finished in ${System.currentTimeMillis() - startedAt} ms " +
            "(${plan.walls.size} walls, ${plan.dimensions.size} dimensions)")
        ExtractionOutput(plan, loaded.localCopy, bitmap)
    }

    private suspend fun runOcr(bitmap: Bitmap): List<OcrLine> = try {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val result = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await()
        recognizer.close()
        val lines = result.textBlocks.flatMap { block ->
            block.lines.map { line ->
                OcrLine(
                    text = line.text,
                    centerXPx = line.boundingBox?.exactCenterX() ?: 0f,
                    centerYPx = line.boundingBox?.exactCenterY() ?: 0f,
                )
            }
        }
        log.d(TAG, "OCR recognised ${lines.size} text lines")
        lines
    } catch (e: Exception) {
        // ML Kit can fail on devices without its native libs or on odd bitmaps —
        // never let that kill the pipeline; geometry alone still yields a model.
        log.e(TAG, "OCR failed; continuing with geometry only", e)
        emptyList()
    }

    companion object {
        private const val TAG = "PlanExtractionPipeline"
    }
}
