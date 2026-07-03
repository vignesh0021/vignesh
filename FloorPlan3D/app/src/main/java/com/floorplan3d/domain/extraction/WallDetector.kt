package com.floorplan3d.domain.extraction

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** An axis-aligned wall found in the raster, in original-image pixel coordinates (centreline). */
data class DetectedWall(
    val x1Px: Float, val y1Px: Float,
    val x2Px: Float, val y2Px: Float,
    val thicknessPx: Float,
)

data class WallDetectionResult(
    val walls: List<DetectedWall>,
    /** Bounding box of dark plan content: left, top, right, bottom (original px). */
    val contentBounds: FloatArray,
    val usedFallback: Boolean,
    val warnings: List<String>,
)

/**
 * Detects walls in a rasterised floor plan.
 *
 * Approach (pure Kotlin over an ARGB pixel array, no native dependencies):
 *  1. Grayscale + adaptive threshold to a binary "ink" mask (auto-inverts white-on-dark scans).
 *  2. Downscale to a working grid for speed and noise suppression.
 *  3. Morphological erosion removes hair-line strokes (dimension lines, text) so
 *     only thick strokes — walls — survive.
 *  4. Row/column run-scanning merges surviving runs into horizontal and vertical
 *     wall bands, which become centreline segments with thickness.
 *  5. If detection yields too little (photo of poor quality, hand sketch), falls
 *     back to the content bounding box as a 4-wall perimeter so the user always
 *     gets a navigable 3D model, with an explicit warning.
 *
 * Assumes predominantly axis-aligned walls, which covers the vast majority of
 * residential floor plans.
 */
class WallDetector(private val log: PlanLogger = PlanLog) {

    fun detect(pixels: IntArray, width: Int, height: Int): WallDetectionResult {
        require(pixels.size >= width * height) { "pixel buffer smaller than width*height" }
        val warnings = mutableListOf<String>()

        // -- 1. Binarise ------------------------------------------------------
        val gray = IntArray(width * height)
        var sum = 0L
        for (i in 0 until width * height) {
            val p = pixels[i]
            val g = (((p shr 16) and 0xFF) * 299 + ((p shr 8) and 0xFF) * 587 + (p and 0xFF) * 114) / 1000
            gray[i] = g
            sum += g
        }
        val mean = (sum / (width * height)).toInt()
        val threshold = max(40, min(215, mean - 40))
        var darkCount = 0
        for (g in gray) if (g < threshold) darkCount++
        // If more than half the image is "dark", it is a white-on-dark scan: invert.
        val inverted = darkCount > width * height / 2
        if (inverted) log.d(TAG, "Image appears inverted (dark background); flipping mask")

        // -- 2. Downscale to working grid --------------------------------------
        val scale = max(1, (max(width, height) + GRID_MAX - 1) / GRID_MAX)
        val gw = max(1, width / scale)
        val gh = max(1, height / scale)
        val mask = BooleanArray(gw * gh)
        for (gy in 0 until gh) {
            for (gx in 0 until gw) {
                var dark = 0
                var total = 0
                for (dy in 0 until scale) {
                    val y = gy * scale + dy
                    if (y >= height) break
                    val rowBase = y * width
                    for (dx in 0 until scale) {
                        val x = gx * scale + dx
                        if (x >= width) break
                        total++
                        val isDark = (gray[rowBase + x] < threshold) != inverted
                        if (isDark) dark++
                    }
                }
                mask[gy * gw + gx] = total > 0 && dark * 2 >= total
            }
        }

        // Content bounds (original px) from the raw mask.
        var minX = gw; var minY = gh; var maxX = -1; var maxY = -1
        for (gy in 0 until gh) for (gx in 0 until gw) {
            if (mask[gy * gw + gx]) {
                if (gx < minX) minX = gx
                if (gx > maxX) maxX = gx
                if (gy < minY) minY = gy
                if (gy > maxY) maxY = gy
            }
        }
        if (maxX < 0) {
            log.w(TAG, "No dark content found in image at all")
            return WallDetectionResult(
                emptyList(),
                floatArrayOf(0f, 0f, width.toFloat(), height.toFloat()),
                usedFallback = true,
                warnings = listOf("The image appears blank; nothing could be extracted"),
            )
        }
        val bounds = floatArrayOf(
            minX * scale.toFloat(), minY * scale.toFloat(),
            (maxX + 1) * scale.toFloat(), (maxY + 1) * scale.toFloat(),
        )

        // -- 3. Erode to keep only thick strokes -------------------------------
        val core = BooleanArray(gw * gh)
        for (gy in 1 until gh - 1) {
            for (gx in 1 until gw - 1) {
                val i = gy * gw + gx
                core[i] = mask[i] && mask[i - 1] && mask[i + 1] && mask[i - gw] && mask[i + gw]
            }
        }

        // -- 4. Run-scan into wall bands ---------------------------------------
        val minRun = max(4, (max(gw, gh) * MIN_WALL_FRACTION).roundToInt())
        val horizontal = scanBands(core, gw, gh, minRun, horizontal = true)
        val vertical = scanBands(core, gw, gh, minRun, horizontal = false)

        val walls = mutableListOf<DetectedWall>()
        val toPx = scale.toFloat()
        for (b in horizontal) {
            val cy = (b.lo + b.hi + 1) / 2f * toPx
            walls += DetectedWall(b.start * toPx, cy, (b.end + 1) * toPx, cy, (b.hi - b.lo + 1) * toPx)
        }
        for (b in vertical) {
            val cx = (b.lo + b.hi + 1) / 2f * toPx
            walls += DetectedWall(cx, b.start * toPx, cx, (b.end + 1) * toPx, (b.hi - b.lo + 1) * toPx)
        }

        log.d(TAG, "Detected ${horizontal.size} horizontal + ${vertical.size} vertical wall bands " +
            "(grid ${gw}x$gh, scale=$scale, threshold=$threshold, minRun=$minRun)")

        // -- 5. Fallback --------------------------------------------------------
        if (walls.size < 4) {
            log.w(TAG, "Only ${walls.size} walls detected; falling back to perimeter box")
            warnings += "Wall layout was unclear; showing the plan outline as a perimeter model"
            val t = max(3f, min(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.02f)
            val l = bounds[0]; val tp = bounds[1]; val r = bounds[2]; val btm = bounds[3]
            return WallDetectionResult(
                listOf(
                    DetectedWall(l, tp, r, tp, t),
                    DetectedWall(l, btm, r, btm, t),
                    DetectedWall(l, tp, l, btm, t),
                    DetectedWall(r, tp, r, btm, t),
                ),
                bounds, usedFallback = true, warnings = warnings,
            )
        }
        return WallDetectionResult(walls, bounds, usedFallback = false, warnings = warnings)
    }

    /** A merged band of runs: along-axis start..end, across-axis lo..hi (grid cells). */
    private data class Band(var start: Int, var end: Int, var lo: Int, var hi: Int)

    private fun scanBands(core: BooleanArray, gw: Int, gh: Int, minRun: Int, horizontal: Boolean): List<Band> {
        val lanes = if (horizontal) gh else gw
        val lengthAxis = if (horizontal) gw else gh
        val bands = mutableListOf<Band>()
        val open = mutableListOf<Band>()

        for (lane in 0 until lanes) {
            // Collect runs of core cells along this lane.
            val runs = mutableListOf<IntArray>()
            var runStart = -1
            for (i in 0 until lengthAxis) {
                val cell = if (horizontal) core[lane * gw + i] else core[i * gw + lane]
                if (cell) {
                    if (runStart < 0) runStart = i
                } else if (runStart >= 0) {
                    if (i - runStart >= minRun) runs += intArrayOf(runStart, i - 1)
                    runStart = -1
                }
            }
            if (runStart >= 0 && lengthAxis - runStart >= minRun) runs += intArrayOf(runStart, lengthAxis - 1)

            // Merge with open bands from the previous lane (>=50% overlap).
            val next = mutableListOf<Band>()
            for (run in runs) {
                val match = open.firstOrNull { b ->
                    b.hi == lane - 1 && overlap(b.start, b.end, run[0], run[1]) * 2 >=
                        min(b.end - b.start, run[1] - run[0]) + 1
                }
                if (match != null) {
                    match.start = min(match.start, run[0])
                    match.end = max(match.end, run[1])
                    match.hi = lane
                    next += match
                    open.remove(match)
                } else {
                    next += Band(run[0], run[1], lane, lane)
                }
            }
            bands += open // bands that did not continue are finished
            open.clear()
            open += next
        }
        bands += open
        // A genuine wall band is much longer than thick.
        return bands.filter { (it.end - it.start + 1) >= 2 * (it.hi - it.lo + 1) }
    }

    private fun overlap(a1: Int, a2: Int, b1: Int, b2: Int): Int =
        max(0, min(a2, b2) - max(a1, b1) + 1)

    companion object {
        private const val TAG = "WallDetector"
        /** Working grid max dimension; keeps detection O(400²) regardless of input size. */
        const val GRID_MAX = 400
        /** A wall must span at least this fraction of the larger image dimension. */
        const val MIN_WALL_FRACTION = 0.035
    }
}
