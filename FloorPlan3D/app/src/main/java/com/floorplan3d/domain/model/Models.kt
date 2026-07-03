package com.floorplan3d.domain.model

import kotlinx.serialization.Serializable
import kotlin.math.hypot

/** Construction materials the parser can recognise on a plan. */
@Serializable
enum class MaterialType(val displayName: String, val unit: String) {
    BRICK("Bricks", "pcs"),
    CEMENT("Cement", "bags"),
    SAND("Sand", "m³"),
    AGGREGATE("Aggregate", "m³"),
    STEEL("Steel (TMT)", "kg"),
    CONCRETE("Ready-mix concrete", "m³"),
    TILE("Floor tiles", "m²"),
    PAINT("Paint", "L"),
    TIMBER("Timber", "m³"),
    GLASS("Glass", "m²"),
    GYPSUM("Gypsum board", "m²"),
    MARBLE("Marble/Granite", "m²"),
}

/** A wall extruded from the 2D plan. Coordinates are millimetres in plan space (x right, y down). */
@Serializable
data class WallSegment(
    val startXMm: Double,
    val startYMm: Double,
    val endXMm: Double,
    val endYMm: Double,
    val thicknessMm: Double,
    val heightMm: Double,
    /** Bottom of the wall above ground level — storey index × storey height. */
    val baseMm: Double = 0.0,
) {
    val lengthMm: Double get() = hypot(endXMm - startXMm, endYMm - startYMm)
    val isHorizontal: Boolean get() = kotlin.math.abs(endYMm - startYMm) <= kotlin.math.abs(endXMm - startXMm)
}

/** A linear dimension read from the plan annotations. Pixel anchor is kept for labelling. */
@Serializable
data class Dimension(
    val valueMm: Double,
    val rawText: String,
    val xPx: Float? = null,
    val yPx: Float? = null,
)

/** An elevation/level annotation, e.g. "FFL +0.45" or "EL. +3.00". */
@Serializable
data class ElevationMark(
    val valueMm: Double,
    val label: String,
    val rawText: String,
    val xPx: Float? = null,
    val yPx: Float? = null,
)

/** Fully-extracted plan, ready for meshing, costing and persistence. */
@Serializable
data class FloorPlan(
    val name: String = "Untitled plan",
    val widthMm: Double,
    val depthMm: Double,
    val walls: List<WallSegment>,
    val dimensions: List<Dimension> = emptyList(),
    val elevations: List<ElevationMark> = emptyList(),
    val wallHeightMm: Double = DEFAULT_WALL_HEIGHT_MM,
    val floorThicknessMm: Double = DEFAULT_SLAB_THICKNESS_MM,
    val materials: List<MaterialType> = emptyList(),
    val scaleMmPerPx: Double = 0.0,
    val scaleRatio: Int? = null,
    val warnings: List<String> = emptyList(),
    /** Number of storeys stacked in the model (multi-plan sheets yield one per floor). */
    val floorCount: Int = 1,
) {
    val floorAreaM2: Double get() = (widthMm / 1000.0) * (depthMm / 1000.0)

    companion object {
        const val DEFAULT_WALL_HEIGHT_MM = 3000.0
        const val DEFAULT_SLAB_THICKNESS_MM = 150.0
    }
}

/** One line of a cost estimate. */
@Serializable
data class CostLine(
    val material: MaterialType,
    val quantity: Double,
    val unit: String,
    val unitPrice: Double,
    val total: Double,
    val note: String = "",
)

/** Complete cost estimate for a plan. */
@Serializable
data class CostEstimate(
    val lines: List<CostLine>,
    val grandTotal: Double,
    val currencySymbol: String = "₹",
    val pricesAsOfMillis: Long = 0L,
    val assumptions: List<String> = emptyList(),
)
