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
    /** Bounding box of the analysed plan's ink: left, top, right, bottom (original px). */
    val contentBounds: FloatArray,
    val usedFallback: Boolean,
    val warnings: List<String>,
)

/**
 * Detects walls in a rasterised floor plan. Pure Kotlin, no native dependencies.
 *
 * Pipeline:
 *  1. Grayscale + adaptive threshold to a binary "ink" mask (auto-inverts
 *     white-on-dark scans).
 *  2. Region isolation: professional CAD sheets carry several floor plans plus
 *     a title block on one page. Ink is clustered into connected tile regions
 *     and the densest cluster is taken as THE plan; everything else (other
 *     storeys, title block, legends) is ignored.
 *  3. Morphological erosion at full pixel resolution removes hair-line strokes
 *     (dimension lines, text, furniture) while strokes 3 px and thicker —
 *     walls — survive. Full resolution matters: wall thickness is a property
 *     of the drawing's line weights, not of the sheet size.
 *  4. The eroded mask is downscaled to a working grid and row/column run-scans
 *     merge surviving runs into horizontal and vertical wall bands.
 *  5. If detection still yields too little (photo of a hand sketch, very poor
 *     quality), falls back to the region's ink bounding box as a 4-wall
 *     perimeter so the user always gets a navigable model, with a warning.
 *
 * Assumes predominantly axis-aligned walls, which covers the vast majority of
 * residential floor plans.
 */
class WallDetector(private val log: PlanLogger = PlanLog) {

    fun detect(pixels: IntArray, width: Int, height: Int): WallDetectionResult {
        require(pixels.size >= width * height) { "pixel buffer smaller than width*height" }
        val warnings = mutableListOf<String>()

        // -- 1. Binarise ------------------------------------------------------
        val ink = BooleanArray(width * height)
        var sum = 0L
        val gray = IntArray(width * height)
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
        val inverted = darkCount > width * height / 2
        if (inverted) log.d(TAG, "Image appears inverted (dark background); flipping mask")
        for (i in 0 until width * height) ink[i] = (gray[i] < threshold) != inverted

        // -- 2. Isolate the main plan region -----------------------------------
        val region = PlanRegionFinder.find(ink, width, height)
        if (region == null) {
            log.w(TAG, "No dark content found in image at all")
            return WallDetectionResult(
                emptyList(),
                floatArrayOf(0f, 0f, width.toFloat(), height.toFloat()),
                usedFallback = true,
                warnings = listOf("The image appears blank; nothing could be extracted"),
            )
        }
        val (rx0, ry0, rx1, ry1) = region
        if ((rx1 - rx0 + 1) * (ry1 - ry0 + 1) < width.toLong() * height / 2) {
            log.d(TAG, "Isolated plan region ($rx0,$ry0)-($rx1,$ry1) out of ${width}x$height sheet")
        }

        // Ink bounds within the region.
        var minX = rx1 + 1; var minY = ry1 + 1; var maxX = rx0 - 1; var maxY = ry0 - 1
        for (y in ry0..ry1) {
            val base = y * width
            for (x in rx0..rx1) {
                if (ink[base + x]) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
        }
        val bounds = floatArrayOf(minX.toFloat(), minY.toFloat(), (maxX + 1).toFloat(), (maxY + 1).toFloat())

        // -- 3. Erode at full resolution (region only) --------------------------
        val rw = rx1 - rx0 + 1
        val rh = ry1 - ry0 + 1
        val core = BooleanArray(rw * rh)
        for (y in 1 until rh - 1) {
            val gy = (ry0 + y) * width + rx0
            for (x in 1 until rw - 1) {
                val i = gy + x
                core[y * rw + x] = ink[i] && ink[i - 1] && ink[i + 1] && ink[i - width] && ink[i + width]
            }
        }

        // -- 4. Downscale eroded mask and scan wall bands -----------------------
        val scale = max(1, (max(rw, rh) + GRID_MAX - 1) / GRID_MAX)
        val gw = max(1, rw / scale)
        val gh = max(1, rh / scale)
        val grid = BooleanArray(gw * gh)
        val needed = max(1, scale / 2)
        for (gy in 0 until gh) {
            for (gx in 0 until gw) {
                var dark = 0
                loop@ for (dy in 0 until scale) {
                    val y = gy * scale + dy
                    if (y >= rh) break
                    val rowBase = y * rw
                    for (dx in 0 until scale) {
                        val x = gx * scale + dx
                        if (x >= rw) break
                        if (core[rowBase + x]) {
                            dark++
                            if (dark >= needed) break@loop
                        }
                    }
                }
                grid[gy * gw + gx] = dark >= needed
            }
        }

        val minRun = max(4, (max(gw, gh) * MIN_WALL_FRACTION).roundToInt())
        val horizontal = scanBands(grid, gw, gh, minRun, horizontal = true)
        val vertical = scanBands(grid, gw, gh, minRun, horizontal = false)

        val walls = mutableListOf<DetectedWall>()
        val toPx = scale.toFloat()
        // Erosion shaves ~1 px per side; add it back to the reported thickness.
        for (b in horizontal) {
            val cy = ry0 + (b.lo + b.hi + 1) / 2f * toPx
            walls += DetectedWall(
                rx0 + b.start * toPx, cy, rx0 + (b.end + 1) * toPx, cy,
                (b.hi - b.lo + 1) * toPx + 2f,
            )
        }
        for (b in vertical) {
            val cx = rx0 + (b.lo + b.hi + 1) / 2f * toPx
            walls += DetectedWall(
                cx, ry0 + b.start * toPx, cx, ry0 + (b.end + 1) * toPx,
                (b.hi - b.lo + 1) * toPx + 2f,
            )
        }

        log.d(TAG, "Detected ${horizontal.size} horizontal + ${vertical.size} vertical wall bands " +
            "(region ${rw}x$rh, grid ${gw}x$gh, scale=$scale, threshold=$threshold, minRun=$minRun)")

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

    private operator fun IntArray.component1() = this[0]
    private operator fun IntArray.component2() = this[1]
    private operator fun IntArray.component3() = this[2]
    private operator fun IntArray.component4() = this[3]

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
        /** Working grid max dimension for band scanning (after full-res erosion). */
        const val GRID_MAX = 600
        /** A wall must span at least this fraction of the plan region's larger dimension. */
        const val MIN_WALL_FRACTION = 0.035
    }
}

/**
 * Finds the main floor-plan cluster on a sheet that may contain several plans,
 * a title block and legends.
 *
 * The ink mask is summarised into TILE-sized cells; cells with meaningful ink
 * density (hair-line sheet borders stay below the threshold) are clustered via
 * 8-connected components, and the component with the most ink wins. Returns
 * inclusive pixel bounds x0,y0,x1,y1 expanded by one tile margin, or null for
 * a blank image.
 */
object PlanRegionFinder {
    const val TILE = 16
    /** Minimum fraction of a tile that must be ink — a 1–2 px border line is ~6–12%. */
    const val MIN_TILE_INK = 0.13

    fun find(ink: BooleanArray, width: Int, height: Int): IntArray? {
        val tw = (width + TILE - 1) / TILE
        val th = (height + TILE - 1) / TILE
        val inkCount = IntArray(tw * th)
        var any = false
        for (y in 0 until height) {
            val ty = y / TILE
            val rowBase = y * width
            val tileRow = ty * tw
            for (x in 0 until width) {
                if (ink[rowBase + x]) {
                    inkCount[tileRow + x / TILE]++
                    any = true
                }
            }
        }
        if (!any) return null

        val solid = BooleanArray(tw * th)
        for (ty in 0 until th) {
            for (tx in 0 until tw) {
                val w = min(TILE, width - tx * TILE)
                val h = min(TILE, height - ty * TILE)
                solid[ty * tw + tx] = inkCount[ty * tw + tx] >= (w * h * MIN_TILE_INK).toInt().coerceAtLeast(1)
            }
        }

        // 8-connected components over solid tiles; score = total ink pixels.
        val label = IntArray(tw * th) { -1 }
        var bestScore = -1L
        var best: IntArray? = null
        val stack = ArrayDeque<Int>()
        var currentLabel = 0
        for (start in 0 until tw * th) {
            if (!solid[start] || label[start] >= 0) continue
            var score = 0L
            var minTx = tw; var minTy = th; var maxTx = -1; var maxTy = -1
            stack.addLast(start)
            label[start] = currentLabel
            while (stack.isNotEmpty()) {
                val t = stack.removeLast()
                val tx = t % tw
                val ty = t / tw
                score += inkCount[t]
                if (tx < minTx) minTx = tx
                if (tx > maxTx) maxTx = tx
                if (ty < minTy) minTy = ty
                if (ty > maxTy) maxTy = ty
                for (dy in -1..1) for (dx in -1..1) {
                    if (dx == 0 && dy == 0) continue
                    val nx = tx + dx
                    val ny = ty + dy
                    if (nx in 0 until tw && ny in 0 until th) {
                        val n = ny * tw + nx
                        if (solid[n] && label[n] < 0) {
                            label[n] = currentLabel
                            stack.addLast(n)
                        }
                    }
                }
            }
            if (score > bestScore) {
                bestScore = score
                best = intArrayOf(minTx, minTy, maxTx, maxTy)
            }
            currentLabel++
        }

        val b = best ?: return intArrayOf(0, 0, width - 1, height - 1)
        // One-tile margin so wall edges and hugging dimension text stay inside.
        val x0 = max(0, (b[0] - 1) * TILE)
        val y0 = max(0, (b[1] - 1) * TILE)
        val x1 = min(width - 1, (b[2] + 2) * TILE - 1)
        val y1 = min(height - 1, (b[3] + 2) * TILE - 1)
        return intArrayOf(x0, y0, x1, y1)
    }
}
