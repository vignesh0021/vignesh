package com.floorplan3d.domain.geometry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Mat4Test {

    @Test
    fun `identity leaves point unchanged`() {
        val p = Mat4.project(Mat4.identity(), 0.25f, -0.5f, 0.75f)!!
        assertEquals(0.25f, p[0], 1e-5f)
        assertEquals(-0.5f, p[1], 1e-5f)
        assertEquals(0.75f, p[2], 1e-5f)
    }

    @Test
    fun `point at look-at target projects to screen centre`() {
        val view = Mat4.lookAt(5f, 5f, 5f, 0f, 0f, 0f, 0f, 1f, 0f)
        val proj = Mat4.perspective(45f, 1.5f, 0.1f, 100f)
        val vp = Mat4.multiply(proj, view)
        val ndc = Mat4.project(vp, 0f, 0f, 0f)!!
        assertEquals(0f, ndc[0], 1e-4f)
        assertEquals(0f, ndc[1], 1e-4f)
    }

    @Test
    fun `point behind camera is rejected`() {
        val view = Mat4.lookAt(0f, 0f, 5f, 0f, 0f, 0f, 0f, 1f, 0f)
        val proj = Mat4.perspective(45f, 1f, 0.1f, 100f)
        val vp = Mat4.multiply(proj, view)
        assertNull(Mat4.project(vp, 0f, 0f, 50f)) // behind the eye at z=+5 looking at origin
        assertNotNull(Mat4.project(vp, 0f, 0f, 0f))
    }

    @Test
    fun `higher point projects higher on screen`() {
        val view = Mat4.lookAt(0f, 2f, 10f, 0f, 2f, 0f, 0f, 1f, 0f)
        val proj = Mat4.perspective(45f, 1f, 0.1f, 100f)
        val vp = Mat4.multiply(proj, view)
        val low = Mat4.project(vp, 0f, 1f, 0f)!!
        val high = Mat4.project(vp, 0f, 3f, 0f)!!
        assertTrue(high[1] > low[1])
    }

    @Test
    fun `ortho maps extents to unit cube`() {
        val m = Mat4.ortho(-10f, 10f, -5f, 5f, 0f, 100f)
        val p = Mat4.project(m, 10f, 5f, -50f)!!
        assertEquals(1f, p[0], 1e-5f)
        assertEquals(1f, p[1], 1e-5f)
    }

    @Test
    fun `multiply respects order`() {
        // Rotating 90° about Y then projecting is not commutative — sanity-check
        // that multiply(A, B) applies B first.
        val rot = Mat4.rotationY(90f)
        val p = Mat4.project(rot, 1f, 0f, 0f)!!
        // +X rotates to -Z under our convention.
        assertEquals(0f, p[0], 1e-4f)
        assertEquals(-1f, p[2], 1e-4f)
    }
}
