package com.floorplan3d.domain.estimation

import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.MaterialType

/** Material quantities computed from the 3D model geometry. */
data class Quantities(
    val wallVolumeM3: Double,
    val wallSurfaceM2: Double,
    val floorAreaM2: Double,
    val slabVolumeM3: Double,
    /** Per-material quantity in that material's natural unit. */
    val byMaterial: Map<MaterialType, Double>,
    val assumptions: List<String>,
)

/**
 * Quantity take-off from the extruded model, using standard CPWD-style thumb
 * rules for residential construction. Every constant is documented so the
 * estimate is auditable; the price side lives in [CostEstimator].
 */
object QuantityTakeoff {

    // Thumb rules (per unit of measured geometry).
    const val BRICKS_PER_M3 = 500.0            // modular bricks incl. mortar joints
    const val BRICKWORK_CEMENT_BAGS_PER_M3 = 1.5
    const val BRICKWORK_SAND_M3_PER_M3 = 0.30
    const val PLASTER_CEMENT_BAGS_PER_M2 = 0.09 // 12 mm two-face plaster handled via area
    const val PLASTER_SAND_M3_PER_M2 = 0.012
    const val RCC_CEMENT_BAGS_PER_M3 = 8.0
    const val RCC_SAND_M3_PER_M3 = 0.45
    const val RCC_AGGREGATE_M3_PER_M3 = 0.90
    const val RCC_STEEL_KG_PER_M3 = 80.0
    const val PAINT_LITRES_PER_M2 = 0.18       // two coats emulsion
    const val TILE_WASTAGE_FACTOR = 1.10

    fun compute(plan: FloorPlan): Quantities {
        val assumptions = mutableListOf<String>()

        val wallVolume = plan.walls.sumOf {
            (it.lengthMm / 1000.0) * (it.heightMm / 1000.0) * (it.thicknessMm / 1000.0)
        }
        val wallSurface = plan.walls.sumOf {
            2.0 * (it.lengthMm / 1000.0) * (it.heightMm / 1000.0)
        }
        val floorArea = plan.floorAreaM2
        val slabVolume = floorArea * (plan.floorThicknessMm / 1000.0)

        assumptions += "Wall volume %.1f m³, wall surface %.0f m², floor area %.0f m²"
            .format(wallVolume, wallSurface, floorArea)
        assumptions += "Slab thickness ${(plan.floorThicknessMm).toInt()} mm; openings not deducted"

        val materials = plan.materials.toSet()
        val q = mutableMapOf<MaterialType, Double>()

        fun add(type: MaterialType, amount: Double) {
            if (amount > 0) q.merge(type, amount, Double::plus)
        }

        if (MaterialType.BRICK in materials) {
            add(MaterialType.BRICK, wallVolume * BRICKS_PER_M3)
            add(MaterialType.CEMENT, wallVolume * BRICKWORK_CEMENT_BAGS_PER_M3)
            add(MaterialType.SAND, wallVolume * BRICKWORK_SAND_M3_PER_M3)
            // Plaster on both wall faces.
            add(MaterialType.CEMENT, wallSurface * PLASTER_CEMENT_BAGS_PER_M2)
            add(MaterialType.SAND, wallSurface * PLASTER_SAND_M3_PER_M2)
        }
        if (MaterialType.CONCRETE in materials) {
            add(MaterialType.CEMENT, slabVolume * RCC_CEMENT_BAGS_PER_M3)
            add(MaterialType.SAND, slabVolume * RCC_SAND_M3_PER_M3)
            add(MaterialType.AGGREGATE, slabVolume * RCC_AGGREGATE_M3_PER_M3)
            add(MaterialType.STEEL, slabVolume * RCC_STEEL_KG_PER_M3)
        } else if (MaterialType.STEEL in materials) {
            add(MaterialType.STEEL, slabVolume * RCC_STEEL_KG_PER_M3)
        }
        if (MaterialType.TILE in materials) add(MaterialType.TILE, floorArea * TILE_WASTAGE_FACTOR)
        if (MaterialType.MARBLE in materials) add(MaterialType.MARBLE, floorArea * TILE_WASTAGE_FACTOR)
        if (MaterialType.PAINT in materials) add(MaterialType.PAINT, wallSurface * PAINT_LITRES_PER_M2)
        if (MaterialType.GYPSUM in materials) add(MaterialType.GYPSUM, floorArea)
        if (MaterialType.TIMBER in materials) {
            add(MaterialType.TIMBER, floorArea * 0.01)
            assumptions += "Timber estimated at 0.01 m³ per m² of floor (doors/frames)"
        }
        if (MaterialType.GLASS in materials) {
            add(MaterialType.GLASS, wallSurface * 0.05)
            assumptions += "Glazing estimated at 5% of wall surface"
        }

        return Quantities(wallVolume, wallSurface, floorArea, slabVolume, q, assumptions)
    }
}
