package com.floorplan3d.domain.estimation

import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.MaterialType
import com.floorplan3d.domain.model.WallSegment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CostEstimatorTest {

    // 10 m wall, 3 m high, 0.2 m thick → volume 6 m³, faces 60 m².
    private val wall = WallSegment(0.0, 0.0, 10_000.0, 0.0, 200.0, 3000.0)

    private fun plan(materials: List<MaterialType>) = FloorPlan(
        widthMm = 10_000.0,
        depthMm = 10_000.0,   // floor area 100 m²
        walls = listOf(wall),
        materials = materials,
        floorThicknessMm = 150.0, // slab volume 15 m³
    )

    private val estimator = CostEstimator()

    @Test
    fun `quantity takeoff computes geometry-derived quantities`() {
        val q = QuantityTakeoff.compute(plan(listOf(MaterialType.BRICK, MaterialType.CONCRETE)))
        assertEquals(6.0, q.wallVolumeM3, 0.001)
        assertEquals(60.0, q.wallSurfaceM2, 0.001)
        assertEquals(100.0, q.floorAreaM2, 0.001)
        assertEquals(15.0, q.slabVolumeM3, 0.001)

        assertEquals(6.0 * QuantityTakeoff.BRICKS_PER_M3, q.byMaterial[MaterialType.BRICK]!!, 0.1)
        assertEquals(15.0 * QuantityTakeoff.RCC_STEEL_KG_PER_M3, q.byMaterial[MaterialType.STEEL]!!, 0.1)
        // Cement from brickwork + plaster + RCC.
        val expectedCement = 6.0 * QuantityTakeoff.BRICKWORK_CEMENT_BAGS_PER_M3 +
            60.0 * QuantityTakeoff.PLASTER_CEMENT_BAGS_PER_M2 +
            15.0 * QuantityTakeoff.RCC_CEMENT_BAGS_PER_M3
        assertEquals(expectedCement, q.byMaterial[MaterialType.CEMENT]!!, 0.01)
    }

    @Test
    fun `estimate multiplies quantities by unit prices`() {
        val prices = mapOf(
            MaterialType.BRICK to MaterialPrice(MaterialType.BRICK, 10.0, "pcs", 1000L, "test"),
        )
        val estimate = estimator.estimate(plan(listOf(MaterialType.BRICK)), prices)
        val brickLine = estimate.lines.first { it.material == MaterialType.BRICK }
        assertEquals(3000.0, brickLine.quantity, 0.1) // 6 m³ × 500/m³
        assertEquals(30_000.0, brickLine.total, 0.1)
        assertTrue(estimate.grandTotal >= brickLine.total)
    }

    @Test
    fun `missing price excludes line with assumption note`() {
        val estimate = estimator.estimate(plan(listOf(MaterialType.BRICK)), emptyMap())
        assertTrue(estimate.lines.isEmpty())
        assertEquals(0.0, estimate.grandTotal, 0.001)
        assertTrue(estimate.assumptions.any { it.contains("No price", ignoreCase = true) })
    }

    @Test
    fun `default catalog prices every material`() {
        val prices = DefaultPriceCatalog.prices()
        MaterialType.entries.forEach { material ->
            assertTrue("missing default price for $material", prices.containsKey(material))
            assertTrue(prices[material]!!.pricePerUnit > 0)
        }
    }

    @Test
    fun `full estimate with default catalog is positive and complete`() {
        val estimate = estimator.estimate(
            plan(listOf(MaterialType.BRICK, MaterialType.CONCRETE, MaterialType.TILE, MaterialType.PAINT)),
            DefaultPriceCatalog.prices(),
        )
        assertTrue(estimate.grandTotal > 0)
        val materialsInLines = estimate.lines.map { it.material }.toSet()
        assertTrue(MaterialType.BRICK in materialsInLines)
        assertTrue(MaterialType.STEEL in materialsInLines)   // implied by CONCRETE
        assertTrue(MaterialType.TILE in materialsInLines)
        assertTrue(MaterialType.PAINT in materialsInLines)
        // Countables rounded up to whole units.
        val bricks = estimate.lines.first { it.material == MaterialType.BRICK }.quantity
        assertEquals(bricks, kotlin.math.ceil(bricks), 0.0)
    }

    @Test
    fun `multiple floors multiply slab and flooring quantities`() {
        val single = QuantityTakeoff.compute(plan(listOf(MaterialType.TILE, MaterialType.CONCRETE)))
        val double = QuantityTakeoff.compute(
            plan(listOf(MaterialType.TILE, MaterialType.CONCRETE)).copy(floorCount = 2))
        assertEquals(single.floorAreaM2 * 2, double.floorAreaM2, 0.001)
        assertEquals(single.slabVolumeM3 * 2, double.slabVolumeM3, 0.001)
        assertEquals(
            single.byMaterial[MaterialType.TILE]!! * 2,
            double.byMaterial[MaterialType.TILE]!!, 0.1)
        // Wall quantities come from the walls themselves, not the floor count.
        assertEquals(single.wallVolumeM3, double.wallVolumeM3, 0.001)
    }

    @Test
    fun `assumptions cite indian standard thumb rules`() {
        val q = QuantityTakeoff.compute(plan(listOf(MaterialType.BRICK, MaterialType.CONCRETE)))
        assertTrue(q.assumptions.any { it.contains("IS 456") })
        assertTrue(q.assumptions.any { it.contains("IS 2212") || it.contains("CPWD") })
    }

    @Test
    fun `plan without walls still estimates floor materials`() {
        val estimate = estimator.estimate(
            plan(listOf(MaterialType.TILE)).copy(walls = emptyList()),
            DefaultPriceCatalog.prices(),
        )
        assertFalse(estimate.lines.isEmpty())
        assertEquals(
            100.0 * QuantityTakeoff.TILE_WASTAGE_FACTOR,
            estimate.lines.first { it.material == MaterialType.TILE }.quantity,
            0.2,
        )
    }
}
