package com.floorplan3d.domain.geometry

import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Minimal column-major 4×4 matrix math (same layout as OpenGL / android.opengl.Matrix),
 * implemented in pure Kotlin so the renderer and the Compose label overlay share
 * exactly the same projection code, and so it is unit-testable on the JVM.
 */
object Mat4 {

    fun identity(): FloatArray = FloatArray(16).also { m ->
        m[0] = 1f; m[5] = 1f; m[10] = 1f; m[15] = 1f
    }

    fun multiply(a: FloatArray, b: FloatArray): FloatArray {
        val r = FloatArray(16)
        for (col in 0 until 4) {
            for (row in 0 until 4) {
                var s = 0f
                for (k in 0 until 4) s += a[k * 4 + row] * b[col * 4 + k]
                r[col * 4 + row] = s
            }
        }
        return r
    }

    fun perspective(fovYDeg: Float, aspect: Float, near: Float, far: Float): FloatArray {
        val f = 1f / tan(Math.toRadians(fovYDeg.toDouble()).toFloat() / 2f)
        val m = FloatArray(16)
        m[0] = f / aspect
        m[5] = f
        m[10] = (far + near) / (near - far)
        m[11] = -1f
        m[14] = 2f * far * near / (near - far)
        return m
    }

    fun ortho(left: Float, right: Float, bottom: Float, top: Float, near: Float, far: Float): FloatArray {
        val m = FloatArray(16)
        m[0] = 2f / (right - left)
        m[5] = 2f / (top - bottom)
        m[10] = -2f / (far - near)
        m[12] = -(right + left) / (right - left)
        m[13] = -(top + bottom) / (top - bottom)
        m[14] = -(far + near) / (far - near)
        m[15] = 1f
        return m
    }

    fun lookAt(
        eyeX: Float, eyeY: Float, eyeZ: Float,
        cX: Float, cY: Float, cZ: Float,
        upX: Float, upY: Float, upZ: Float,
    ): FloatArray {
        var fx = cX - eyeX; var fy = cY - eyeY; var fz = cZ - eyeZ
        val fl = sqrt(fx * fx + fy * fy + fz * fz).takeIf { it > 1e-9f } ?: 1f
        fx /= fl; fy /= fl; fz /= fl
        // s = f × up
        var sx = fy * upZ - fz * upY
        var sy = fz * upX - fx * upZ
        var sz = fx * upY - fy * upX
        val sl = sqrt(sx * sx + sy * sy + sz * sz).takeIf { it > 1e-9f } ?: 1f
        sx /= sl; sy /= sl; sz /= sl
        // u = s × f
        val ux = sy * fz - sz * fy
        val uy = sz * fx - sx * fz
        val uz = sx * fy - sy * fx

        val m = FloatArray(16)
        m[0] = sx; m[4] = sy; m[8] = sz
        m[1] = ux; m[5] = uy; m[9] = uz
        m[2] = -fx; m[6] = -fy; m[10] = -fz
        m[15] = 1f
        m[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ)
        m[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ)
        m[14] = fx * eyeX + fy * eyeY + fz * eyeZ
        return m
    }

    fun rotationY(deg: Float): FloatArray {
        val r = Math.toRadians(deg.toDouble()).toFloat()
        val m = identity()
        m[0] = cos(r); m[8] = sin(r)
        m[2] = -sin(r); m[10] = cos(r)
        return m
    }

    /**
     * Transforms the point (x, y, z, 1) by [m] and returns normalised device coordinates + clip w.
     * Returns null when the point is behind the camera (w <= 0).
     */
    fun project(m: FloatArray, x: Float, y: Float, z: Float): FloatArray? {
        val cx = m[0] * x + m[4] * y + m[8] * z + m[12]
        val cy = m[1] * x + m[5] * y + m[9] * z + m[13]
        val cz = m[2] * x + m[6] * y + m[10] * z + m[14]
        val cw = m[3] * x + m[7] * y + m[11] * z + m[15]
        if (cw <= 1e-6f) return null
        return floatArrayOf(cx / cw, cy / cw, cz / cw, cw)
    }
}
