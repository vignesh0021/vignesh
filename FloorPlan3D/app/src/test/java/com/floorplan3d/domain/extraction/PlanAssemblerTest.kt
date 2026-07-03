package com.floorplan3d.domain.extraction

import com.floorplan3d.domain.model.Dimension
import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.MaterialType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanAssemblerTest {

    private val assembler = PlanAssembler()

    private fun detection(widthPx: Float = 1000f, depthPx: Float = 800f) = WallDetectionResult(
        walls = listOf(
            DetectedWall(0f, 0f, widthPx, 0f, 10f),
            DetectedWall(0f, depthPx, widthPx, depthPx, 10f),
            DetectedWall(0f, 0f, 0f, depthPx, 10f),
            DetectedWall(widthPx, 0f, widthPx, depthPx, 10f),
        ),
        contentBounds = floatArrayOf(0f, 0f, widthPx, depthPx),
        usedFallback = false,
        warnings = emptyList(),
    )

    private fun annotations(
        dimensions: List<Dimension> = emptyList(),
        wallHeightMm: Double? = null,
    ) = ParsedAnnotations(
        dimensions = dimensions,
        elevations = emptyList(),
        scaleRatio = null,
        wallHeightMm = wallHeightMm,
        materials = setOf(MaterialType.BRICK),
        warnings = emptyList(),
    )

    @Test
    fun `resolves scale from largest annotated dimension`() {
        // 1000 px content width annotated as 10 m → 10 mm/px.
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(10_000.0, "10.0 m"))),
        )
        assertEquals(10_000.0, plan.widthMm, 1.0)
        assertEquals(8_000.0, plan.depthMm, 1.0)
        assertEquals(10.0, plan.scaleMmPerPx, 0.01)
    }

    @Test
    fun `falls back to default extent without dimensions`() {
        val plan = assembler.assemble("test", detection(), annotations())
        assertEquals(PlanAssembler.DEFAULT_EXTENT_MM, plan.widthMm, 1.0)
        assertTrue(plan.warnings.any { it.contains("Assuming", ignoreCase = true) })
    }

    @Test
    fun `uses annotated wall height`() {
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(10_000.0, "10 m")), wallHeightMm = 3200.0),
        )
        assertEquals(3200.0, plan.wallHeightMm, 0.01)
        assertTrue(plan.walls.all { it.heightMm == 3200.0 })
    }

    @Test
    fun `defaults wall height with warning when unannotated`() {
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(10_000.0, "10 m"))),
        )
        assertEquals(FloorPlan.DEFAULT_WALL_HEIGHT_MM, plan.wallHeightMm, 0.01)
        assertTrue(plan.warnings.any { it.contains("ceiling height", ignoreCase = true) })
    }

    @Test
    fun `wall thickness is clamped to plausible range`() {
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(50_000.0, "50 m"))), // huge scale → thick walls
        )
        assertTrue(plan.walls.all { it.thicknessMm <= PlanAssembler.MAX_WALL_THICKNESS_MM })
        assertTrue(plan.walls.all { it.thicknessMm >= PlanAssembler.MIN_WALL_THICKNESS_MM })
    }

    @Test
    fun `implausible dimension ratio falls back with warning`() {
        // 400 mm dimension against 1000 px extent → 0.4 mm/px, below the sane band.
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(400.0, "400 mm"))),
        )
        assertEquals(PlanAssembler.DEFAULT_EXTENT_MM, plan.widthMm, 1.0)
        assertTrue(plan.warnings.any { it.contains("scale", ignoreCase = true) })
    }

    @Test
    fun `small annotations never drive scale`() {
        // OCR that only catches a door-sized "3'-3\"" must not shrink the
        // building to a metre — regression for a real CAD sheet upload.
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(990.0, "3'-3\""))),
        )
        assertEquals(PlanAssembler.DEFAULT_EXTENT_MM, plan.widthMm, 1.0)
        assertTrue(plan.walls.size >= 4)
        assertTrue(plan.warnings.any { it.contains("scale", ignoreCase = true) })
    }

    @Test
    fun `keeps detected materials`() {
        val plan = assembler.assemble(
            "test", detection(),
            annotations(dimensions = listOf(Dimension(10_000.0, "10 m"))),
        )
        assertEquals(listOf(MaterialType.BRICK), plan.materials)
    }
}
