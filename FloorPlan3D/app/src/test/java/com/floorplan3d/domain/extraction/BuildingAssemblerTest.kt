package com.floorplan3d.domain.extraction

import com.floorplan3d.domain.model.Dimension
import com.floorplan3d.domain.model.MaterialType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BuildingAssemblerTest {

    private val assembler = BuildingAssembler()

    private fun detection(x0: Float, widthPx: Float = 1000f, depthPx: Float = 800f, fallback: Boolean = false) =
        WallDetectionResult(
            walls = listOf(
                DetectedWall(x0, 0f, x0 + widthPx, 0f, 10f),
                DetectedWall(x0, depthPx, x0 + widthPx, depthPx, 10f),
                DetectedWall(x0, 0f, x0, depthPx, 10f),
                DetectedWall(x0 + widthPx, 0f, x0 + widthPx, depthPx, 10f),
            ),
            contentBounds = floatArrayOf(x0, 0f, x0 + widthPx, depthPx),
            usedFallback = fallback,
            warnings = emptyList(),
        )

    private fun annotations(vararg dims: Dimension) = ParsedAnnotations(
        dimensions = dims.toList(),
        elevations = emptyList(),
        scaleRatio = null,
        wallHeightMm = 3000.0,
        materials = setOf(MaterialType.BRICK),
        warnings = emptyList(),
    )

    @Test
    fun `single plan yields single floor`() {
        val plan = assembler.assemble(
            "test", listOf(detection(0f)),
            annotations(Dimension(10_000.0, "10 m", 500f, 400f)),
        )
        assertEquals(1, plan.floorCount)
        assertTrue(plan.walls.all { it.baseMm == 0.0 })
    }

    @Test
    fun `two plans stack into two storeys ordered left to right`() {
        val plan = assembler.assemble(
            "test",
            listOf(detection(2000f), detection(0f)), // detection order != sheet order
            annotations(
                Dimension(10_000.0, "10 m", 500f, 400f),   // inside left plan
                Dimension(10_000.0, "10 m", 2500f, 400f),  // inside right plan
            ),
        )
        assertEquals(2, plan.floorCount)
        assertEquals(8, plan.walls.size)
        val bases = plan.walls.map { it.baseMm }.distinct().sorted()
        assertEquals(listOf(0.0, 3000.0), bases)
        // All storeys share the storey height.
        assertTrue(plan.walls.all { it.heightMm == 3000.0 })
        assertTrue(plan.warnings.any { it.contains("2 floor plans") })
    }

    @Test
    fun `each floor is scaled from its own region dimensions`() {
        val plan = assembler.assemble(
            "test",
            listOf(detection(0f), detection(2000f)),
            annotations(
                Dimension(10_000.0, "10 m", 500f, 400f),  // left plan: 10 m over 1000 px
                Dimension(5_000.0, "5 m", 2500f, 400f),   // right plan: 5 m over 1000 px
            ),
        )
        val ground = plan.walls.filter { it.baseMm == 0.0 }
        val first = plan.walls.filter { it.baseMm > 0.0 }
        assertEquals(10_000.0, ground.maxOf { it.lengthMm }, 1.0)
        assertEquals(5_000.0, first.maxOf { it.lengthMm }, 1.0)
    }

    @Test
    fun `fallback regions are dropped when other floors exist`() {
        val plan = assembler.assemble(
            "test",
            listOf(detection(0f), detection(2000f, fallback = true)),
            annotations(Dimension(10_000.0, "10 m", 500f, 400f)),
        )
        assertEquals(1, plan.floorCount)
    }
}
