package com.floorplan3d.domain.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class FloorPlanSerializationTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `plans stored before multi-storey support decode with defaults`() {
        // JSON as written by v1.0.0 — no baseMm on walls, no floorCount.
        val legacy = """
            {"name":"old","widthMm":10000.0,"depthMm":8000.0,
             "walls":[{"startXMm":0.0,"startYMm":0.0,"endXMm":10000.0,"endYMm":0.0,
                       "thicknessMm":230.0,"heightMm":3000.0}]}
        """.trimIndent()
        val plan = json.decodeFromString(FloorPlan.serializer(), legacy)
        assertEquals(1, plan.floorCount)
        assertEquals(0.0, plan.walls[0].baseMm, 0.0)
        assertEquals(3000.0, plan.walls[0].heightMm, 0.0)
    }

    @Test
    fun `round trip preserves multi-storey fields`() {
        val plan = FloorPlan(
            widthMm = 10_000.0, depthMm = 8_000.0,
            walls = listOf(WallSegment(0.0, 0.0, 5000.0, 0.0, 230.0, 3200.0, baseMm = 3200.0)),
            floorCount = 2,
        )
        val decoded = json.decodeFromString(
            FloorPlan.serializer(),
            json.encodeToString(FloorPlan.serializer(), plan),
        )
        assertEquals(plan, decoded)
    }
}
