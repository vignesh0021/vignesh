package com.floorplan3d.domain.extraction

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.MaterialType
import com.floorplan3d.domain.model.WallSegment
import kotlin.math.max
import kotlin.math.min

/**
 * Combines geometry (detected walls, in pixels) with parsed annotations into a
 * real-world-scaled [FloorPlan].
 *
 * Scale resolution strategy, in order of confidence:
 *  1. Match the largest annotated dimension to the largest wall extent
 *     (dimension strings on a plan describe its longest runs).
 *  2. No usable dimensions: assume the plan content spans [DEFAULT_EXTENT_MM].
 *
 * Pure Kotlin — unit-testable on the JVM.
 */
class PlanAssembler(private val log: PlanLogger = PlanLog) {

    fun assemble(
        name: String,
        detection: WallDetectionResult,
        annotations: ParsedAnnotations,
    ): FloorPlan {
        val warnings = (detection.warnings + annotations.warnings).toMutableList()

        val contentWidthPx = (detection.contentBounds[2] - detection.contentBounds[0]).toDouble()
        val contentDepthPx = (detection.contentBounds[3] - detection.contentBounds[1]).toDouble()
        val maxExtentPx = max(contentWidthPx, contentDepthPx).coerceAtLeast(1.0)

        val mmPerPx: Double = run {
            // The scale reference must be a plausible overall building dimension:
            // OCR often catches only door/toilet-sized annotations, and scaling a
            // whole floor from a 3 ft reading collapses the model to a metre.
            val maxDim = annotations.dimensions.maxOfOrNull { it.valueMm }
            val ratio = maxDim?.let { it / maxExtentPx }
            when {
                maxDim != null && maxDim >= MIN_SCALE_DIMENSION_MM && ratio!! in 0.5..500.0 -> {
                    log.d(TAG, "Scale from annotations: %.3f mm/px (dim %.0f mm over %.0f px)"
                        .format(ratio, maxDim, maxExtentPx))
                    ratio
                }
                maxDim != null -> {
                    log.w(TAG, "Rejected scale reference %.0f mm over %.0f px".format(maxDim, maxExtentPx))
                    warnings += "Annotated dimensions were too small or did not match the drawing; " +
                        "scale assumes the plan spans ${(DEFAULT_EXTENT_MM / 1000).toInt()} m"
                    DEFAULT_EXTENT_MM / maxExtentPx
                }
                else -> {
                    warnings += "Assuming the plan spans ${(DEFAULT_EXTENT_MM / 1000).toInt()} m " +
                        "across its longest side"
                    DEFAULT_EXTENT_MM / maxExtentPx
                }
            }
        }

        val wallHeightMm = annotations.wallHeightMm
            ?: run {
                // Storey height from consecutive level marks if present (e.g. FFL 0.0 & LVL 3.0).
                val levels = annotations.elevations.map { it.valueMm }.distinct().sorted()
                val storey = levels.zipWithNext { a, b -> b - a }.filter { it in 2400.0..4500.0 }
                if (storey.isNotEmpty()) storey.first()
                else {
                    warnings += "No ceiling height found; using standard " +
                        "${(FloorPlan.DEFAULT_WALL_HEIGHT_MM / 1000)} m"
                    FloorPlan.DEFAULT_WALL_HEIGHT_MM
                }
            }

        // Plan-space origin at content top-left so the model sits near (0,0).
        val ox = detection.contentBounds[0].toDouble()
        val oy = detection.contentBounds[1].toDouble()

        val walls = detection.walls.map { w ->
            WallSegment(
                startXMm = (w.x1Px - ox) * mmPerPx,
                startYMm = (w.y1Px - oy) * mmPerPx,
                endXMm = (w.x2Px - ox) * mmPerPx,
                endYMm = (w.y2Px - oy) * mmPerPx,
                thicknessMm = (w.thicknessPx * mmPerPx).coerceIn(MIN_WALL_THICKNESS_MM, MAX_WALL_THICKNESS_MM),
                heightMm = wallHeightMm,
            )
        }.filter { it.lengthMm >= MIN_WALL_LENGTH_MM }

        val materials = if (annotations.materials.isNotEmpty()) {
            annotations.materials.toList().sorted()
        } else {
            DEFAULT_MATERIALS
        }

        val widthMm = contentWidthPx * mmPerPx
        val depthMm = contentDepthPx * mmPerPx
        log.d(TAG, "Assembled plan \"$name\": %.1f x %.1f m, %d walls, height %.2f m"
            .format(widthMm / 1000, depthMm / 1000, walls.size, wallHeightMm / 1000))

        return FloorPlan(
            name = name,
            widthMm = widthMm,
            depthMm = depthMm,
            walls = walls,
            dimensions = annotations.dimensions.map { d ->
                d.copy(
                    xPx = d.xPx?.let { ((it - ox) * mmPerPx).toFloat() },
                    yPx = d.yPx?.let { ((it - oy) * mmPerPx).toFloat() },
                )
            },
            elevations = annotations.elevations,
            wallHeightMm = wallHeightMm,
            materials = materials,
            scaleMmPerPx = mmPerPx,
            scaleRatio = annotations.scaleRatio,
            warnings = warnings.distinct(),
        )
    }

    companion object {
        private const val TAG = "PlanAssembler"
        const val DEFAULT_EXTENT_MM = 12_000.0
        /** Smallest annotation trusted as an overall building dimension. */
        const val MIN_SCALE_DIMENSION_MM = 3_000.0
        const val MIN_WALL_THICKNESS_MM = 75.0
        const val MAX_WALL_THICKNESS_MM = 600.0
        const val MIN_WALL_LENGTH_MM = 400.0

        private val DEFAULT_MATERIALS = listOf(
            MaterialType.BRICK, MaterialType.CEMENT, MaterialType.SAND,
            MaterialType.AGGREGATE, MaterialType.STEEL, MaterialType.CONCRETE,
            MaterialType.TILE, MaterialType.PAINT,
        )
    }
}
