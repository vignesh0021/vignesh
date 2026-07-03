package com.floorplan3d.domain.extraction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class WallDetectorTest {

    private val detector = WallDetector()

    private val white = 0xFFFFFFFF.toInt()
    private val black = 0xFF000000.toInt()

    /** Draws a filled rectangle of dark pixels into an image. */
    private fun IntArray.fillRect(w: Int, x1: Int, y1: Int, x2: Int, y2: Int, color: Int = black) {
        for (y in y1..y2) for (x in x1..x2) this[y * w + x] = color
    }

    private fun blankImage(w: Int, h: Int, color: Int = white) = IntArray(w * h) { color }

    @Test
    fun `detects perimeter walls of a rectangular plan`() {
        val w = 800; val h = 600
        val img = blankImage(w, h)
        val t = 12 // wall thickness in px
        img.fillRect(w, 100, 100, 700, 100 + t)   // top
        img.fillRect(w, 100, 500 - t, 700, 500)   // bottom
        img.fillRect(w, 100, 100, 100 + t, 500)   // left
        img.fillRect(w, 700 - t, 100, 700, 500)   // right

        val result = detector.detect(img, w, h)
        assertFalse("should not fall back", result.usedFallback)
        assertTrue("expected >= 4 walls, got ${result.walls.size}", result.walls.size >= 4)

        val horizontals = result.walls.filter { abs(it.y1Px - it.y2Px) < 1f }
        val verticals = result.walls.filter { abs(it.x1Px - it.x2Px) < 1f }
        assertTrue(horizontals.size >= 2)
        assertTrue(verticals.size >= 2)

        // Content bounds should hug the drawn plan.
        assertEquals(100f, result.contentBounds[0], 10f)
        assertEquals(100f, result.contentBounds[1], 10f)
        assertEquals(701f, result.contentBounds[2], 10f)
        assertEquals(501f, result.contentBounds[3], 10f)
    }

    @Test
    fun `detects interior partition wall`() {
        val w = 800; val h = 600
        val img = blankImage(w, h)
        val t = 12
        img.fillRect(w, 100, 100, 700, 100 + t)
        img.fillRect(w, 100, 500 - t, 700, 500)
        img.fillRect(w, 100, 100, 100 + t, 500)
        img.fillRect(w, 700 - t, 100, 700, 500)
        img.fillRect(w, 400, 100, 400 + t, 500) // interior vertical wall

        val result = detector.detect(img, w, h)
        val verticals = result.walls.filter { abs(it.x1Px - it.x2Px) < 1f }
        assertTrue("expected >= 3 vertical walls, got ${verticals.size}", verticals.size >= 3)
    }

    @Test
    fun `ignores thin dimension lines`() {
        val w = 800; val h = 600
        val img = blankImage(w, h)
        val t = 12
        img.fillRect(w, 100, 100, 700, 100 + t)
        img.fillRect(w, 100, 500 - t, 700, 500)
        img.fillRect(w, 100, 100, 100 + t, 500)
        img.fillRect(w, 700 - t, 100, 700, 500)
        // Hair-line dimension line below the plan (1px, would be a wall if not eroded).
        img.fillRect(w, 100, 560, 700, 560)

        val result = detector.detect(img, w, h)
        val nearDimensionLine = result.walls.filter { abs(it.y1Px - 560f) < 8f }
        assertTrue("thin line should not become a wall", nearDimensionLine.isEmpty())
    }

    @Test
    fun `white-on-dark scans are auto-inverted`() {
        val w = 800; val h = 600
        val img = blankImage(w, h, black)
        val t = 12
        img.fillRect(w, 100, 100, 700, 100 + t, white)
        img.fillRect(w, 100, 500 - t, 700, 500, white)
        img.fillRect(w, 100, 100, 100 + t, 500, white)
        img.fillRect(w, 700 - t, 100, 700, 500, white)

        val result = detector.detect(img, w, h)
        assertFalse(result.usedFallback)
        assertTrue(result.walls.size >= 4)
    }

    @Test
    fun `blank image reports fallback with warning`() {
        val result = detector.detect(blankImage(400, 300), 400, 300)
        assertTrue(result.usedFallback)
        assertTrue(result.walls.isEmpty())
        assertTrue(result.warnings.isNotEmpty())
    }

    @Test
    fun `noisy sketch falls back to perimeter box`() {
        val w = 400; val h = 300
        val img = blankImage(w, h)
        // A small blob: content exists but no wall-like structure.
        img.fillRect(w, 190, 140, 210, 160)

        val result = detector.detect(img, w, h)
        assertTrue(result.usedFallback)
        assertEquals(4, result.walls.size)
        assertTrue(result.warnings.any { it.contains("outline", ignoreCase = true) ||
            it.contains("unclear", ignoreCase = true) })
    }
}
