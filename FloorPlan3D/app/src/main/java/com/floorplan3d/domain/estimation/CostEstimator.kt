package com.floorplan3d.domain.estimation

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.domain.model.CostEstimate
import com.floorplan3d.domain.model.CostLine
import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.MaterialType
import kotlin.math.ceil
import kotlin.math.roundToInt

/** A unit price with provenance, as stored/fetched by the pricing repository. */
data class MaterialPrice(
    val material: MaterialType,
    val pricePerUnit: Double,
    val unit: String,
    val updatedAtMillis: Long,
    val source: String,
)

/**
 * Turns geometry-derived [Quantities] into a priced bill of materials.
 * Pure Kotlin; prices are injected so tests are deterministic.
 */
class CostEstimator(private val log: PlanLogger = PlanLog) {

    fun estimate(
        plan: FloorPlan,
        prices: Map<MaterialType, MaterialPrice>,
        currencySymbol: String = "₹",
    ): CostEstimate {
        val quantities = QuantityTakeoff.compute(plan)
        val assumptions = quantities.assumptions.toMutableList()
        val lines = mutableListOf<CostLine>()

        for ((material, rawQty) in quantities.byMaterial.entries.sortedBy { it.key.ordinal }) {
            val price = prices[material]
            if (price == null) {
                assumptions += "No price available for ${material.displayName}; excluded from total"
                log.w(TAG, "Missing price for $material")
                continue
            }
            val qty = roundQuantity(material, rawQty)
            lines += CostLine(
                material = material,
                quantity = qty,
                unit = material.unit,
                unitPrice = price.pricePerUnit,
                total = qty * price.pricePerUnit,
                note = price.source,
            )
        }

        val total = lines.sumOf { it.total }
        val asOf = prices.values.maxOfOrNull { it.updatedAtMillis } ?: 0L
        log.d(TAG, "Estimate for \"${plan.name}\": ${lines.size} lines, total %.0f".format(total))
        return CostEstimate(
            lines = lines,
            grandTotal = total,
            currencySymbol = currencySymbol,
            pricesAsOfMillis = asOf,
            assumptions = assumptions,
        )
    }

    /** Countable units round up (you can't buy half a brick); bulk units keep one decimal. */
    private fun roundQuantity(material: MaterialType, qty: Double): Double = when (material) {
        MaterialType.BRICK -> ceil(qty)
        MaterialType.CEMENT -> ceil(qty)
        else -> (qty * 10).roundToInt() / 10.0
    }

    companion object {
        private const val TAG = "CostEstimator"
    }
}

/**
 * Built-in market prices (Indian residential market, mid-2026) used to seed the
 * database and as an offline fallback. Refreshable at runtime from a remote
 * price feed — see PriceRepository.
 */
object DefaultPriceCatalog {
    const val SOURCE = "Built-in market rates"

    fun prices(nowMillis: Long = System.currentTimeMillis()): Map<MaterialType, MaterialPrice> = mapOf(
        MaterialType.BRICK to 9.0,
        MaterialType.CEMENT to 420.0,
        MaterialType.SAND to 1650.0,
        MaterialType.AGGREGATE to 1500.0,
        MaterialType.STEEL to 68.0,
        MaterialType.CONCRETE to 5200.0,
        MaterialType.TILE to 420.0,
        MaterialType.PAINT to 360.0,
        MaterialType.TIMBER to 65000.0,
        MaterialType.GLASS to 1350.0,
        MaterialType.GYPSUM to 320.0,
        MaterialType.MARBLE to 1600.0,
    ).mapValues { (material, price) ->
        MaterialPrice(material, price, material.unit, nowMillis, SOURCE)
    }
}
