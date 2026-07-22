package com.floorplan3d.domain.extraction

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.domain.model.FloorPlan

/**
 * Turns one wall-detection result per floor plan into a single stacked
 * building model.
 *
 * The plan regions are ordered left-to-right as sheets conventionally lay out
 * G → 1 → 2; each floor is scaled from the dimensions annotated inside its own
 * region, so a title-block cluster that slips through simply contributes no
 * walls and is dropped. Pure Kotlin — unit-testable on the JVM.
 */
class BuildingAssembler(
    private val planAssembler: PlanAssembler = PlanAssembler(),
    private val log: PlanLogger = PlanLog,
) {

    fun assemble(
        planName: String,
        detections: List<WallDetectionResult>,
        annotations: ParsedAnnotations,
    ): FloorPlan {
        val floors = detections
            .sortedBy { it.contentBounds[0] } // sheet convention: ground floor leftmost
            .mapNotNull { detection ->
                val regionAnnotations = annotations.copy(
                    dimensions = annotations.dimensions.filter { d ->
                        inRegion(d.xPx, d.yPx, detection.contentBounds)
                    },
                )
                val floor = planAssembler.assemble(planName, detection, regionAnnotations)
                // A region that produced no real walls (legend, notes) is not a floor.
                if (detection.usedFallback && detections.size > 1) null else floor
            }
            .ifEmpty {
                listOf(planAssembler.assemble(planName, detections.first(), annotations))
            }

        val ground = floors.first()
        if (floors.size == 1) return ground

        val storeyHeight = ground.wallHeightMm
        val walls = floors.flatMapIndexed { level, floor ->
            floor.walls.map { it.copy(baseMm = level * storeyHeight, heightMm = storeyHeight) }
        }
        log.d(TAG, "Stacked ${floors.size} storeys (${walls.size} walls total)")
        val stackNote = "Detected ${floors.size} floor plans on the sheet; storeys stacked at " +
            "%.1f m intervals".format(storeyHeight / 1000)
        return ground.copy(
            walls = walls,
            floorCount = floors.size,
            widthMm = floors.maxOf { it.widthMm },
            depthMm = floors.maxOf { it.depthMm },
            elevations = floors.flatMap { it.elevations }.distinctBy { it.label to it.valueMm },
            warnings = (floors.flatMap { it.warnings } + stackNote).distinct(),
        )
    }

    /** True when the point sits inside the bounds expanded by 10% (dimension text hugs the drawing). */
    private fun inRegion(x: Float?, y: Float?, bounds: FloatArray): Boolean {
        if (x == null || y == null || (x == 0f && y == 0f)) return true // unpositioned: keep
        val marginX = (bounds[2] - bounds[0]) * 0.10f
        val marginY = (bounds[3] - bounds[1]) * 0.10f
        return x >= bounds[0] - marginX && x <= bounds[2] + marginX &&
            y >= bounds[1] - marginY && y <= bounds[3] + marginY
    }

    companion object {
        private const val TAG = "BuildingAssembler"
    }
}
