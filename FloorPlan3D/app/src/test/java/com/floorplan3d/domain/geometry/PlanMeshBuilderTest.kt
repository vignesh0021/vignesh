package com.floorplan3d.domain.geometry

import com.floorplan3d.domain.model.ElevationMark
import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.WallSegment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanMeshBuilderTest {

    private fun plan(walls: List<WallSegment>) = FloorPlan(
        widthMm = 10_000.0,
        depthMm = 8_000.0,
        walls = walls,
        elevations = listOf(ElevationMark(450.0, "FFL", "FFL +0.45")),
    )

    private fun wall(x1: Double, y1: Double, x2: Double, y2: Double) =
        WallSegment(x1, y1, x2, y2, thicknessMm = 230.0, heightMm = 3000.0)

    @Test
    fun `mesh contains one box per wall plus floor slab`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(
            wall(0.0, 0.0, 10_000.0, 0.0),
            wall(0.0, 0.0, 0.0, 8_000.0),
        )))
        val boxes = 3 // 2 walls + slab
        assertEquals(boxes * 24, mesh.vertices.size / PlanMeshBuilder.FLOATS_PER_VERTEX)
        assertEquals(boxes * 36, mesh.triangleIndices.size)
        assertEquals(boxes * 48, mesh.lineIndices.size)
    }

    @Test
    fun `model is centred on origin`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(wall(0.0, 0.0, 10_000.0, 0.0))))
        var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE
        for (i in mesh.vertices.indices step PlanMeshBuilder.FLOATS_PER_VERTEX) {
            val x = mesh.vertices[i]
            if (x < minX) minX = x
            if (x > maxX) maxX = x
        }
        assertEquals("centred in X", -(minX), maxX, 0.3f)
    }

    @Test
    fun `wall height becomes mesh height`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(wall(0.0, 0.0, 10_000.0, 0.0))))
        var maxY = -Float.MAX_VALUE
        for (i in mesh.vertices.indices step PlanMeshBuilder.FLOATS_PER_VERTEX) {
            val y = mesh.vertices[i + 1]
            if (y > maxY) maxY = y
        }
        assertEquals(3.0f, maxY, 0.001f)
    }

    @Test
    fun `labels include wall dimension and elevation`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(wall(0.0, 0.0, 10_000.0, 0.0))))
        assertTrue(mesh.labels.any { !it.isElevation && it.text == "10.00 m" })
        assertTrue(mesh.labels.any { it.isElevation && it.text.contains("FFL") })
    }

    @Test
    fun `radius covers the model`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(wall(0.0, 0.0, 10_000.0, 0.0))))
        assertTrue(mesh.radius >= 5f) // half diagonal of 10x8 m is ~6.4 m
    }

    @Test
    fun `capWalls keeps mesh within short index range`() {
        val many = (0 until 3000).map { i ->
            wall(0.0, i * 10.0, 5_000.0 + i.toDouble(), i * 10.0)
        }
        val capped = PlanMeshBuilder.capWalls(many)
        assertTrue(PlanMeshBuilder.fitsInShortIndices(capped.size))
        // Longest walls are preferred.
        assertTrue(capped.first().lengthMm >= capped.last().lengthMm)
    }

    @Test
    fun `two storeys stack walls and slabs`() {
        val twoFloors = plan(listOf(
            wall(0.0, 0.0, 10_000.0, 0.0),
            wall(0.0, 0.0, 10_000.0, 0.0).copy(baseMm = 3000.0),
        )).copy(floorCount = 2)
        val mesh = PlanMeshBuilder.build(twoFloors)
        // 2 walls + 2 slabs = 4 boxes.
        assertEquals(4 * 24, mesh.vertices.size / PlanMeshBuilder.FLOATS_PER_VERTEX)
        var maxY = -Float.MAX_VALUE
        for (i in mesh.vertices.indices step PlanMeshBuilder.FLOATS_PER_VERTEX) {
            if (mesh.vertices[i + 1] > maxY) maxY = mesh.vertices[i + 1]
        }
        assertEquals("upper wall tops out at 6 m", 6.0f, maxY, 0.001f)
    }

    @Test
    fun `triangle indices are within vertex bounds`() {
        val mesh = PlanMeshBuilder.build(plan(listOf(
            wall(0.0, 0.0, 10_000.0, 0.0),
            wall(0.0, 8_000.0, 10_000.0, 8_000.0),
            wall(0.0, 0.0, 0.0, 8_000.0),
        )))
        val vertexCount = mesh.vertices.size / PlanMeshBuilder.FLOATS_PER_VERTEX
        assertTrue(mesh.triangleIndices.all { it >= 0 && it < vertexCount })
        assertTrue(mesh.lineIndices.all { it >= 0 && it < vertexCount })
    }
}
