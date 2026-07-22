package com.floorplan3d.render

import com.floorplan3d.domain.geometry.Mat4
import kotlin.math.cos
import kotlin.math.sin

/** Named camera presets = the app's "views". */
enum class ViewMode(val label: String) {
    PLAN("Plan"),
    ELEVATION_FRONT("Front"),
    ELEVATION_SIDE("Side"),
    ISOMETRIC("Isometric"),
    PERSPECTIVE("3D"),
}

/**
 * Immutable orbit-camera state. Held in Compose state by the ViewModel (so label
 * overlays recompose) and read on the GL thread each frame — immutability makes
 * that share safe without locks.
 */
data class CameraState(
    val mode: ViewMode = ViewMode.ISOMETRIC,
    /** Orbit azimuth in degrees, 0 = looking from +Z (south). */
    val azimuthDeg: Float = 45f,
    /** Elevation angle above the horizon in degrees. */
    val elevationDeg: Float = 35.264f,
    /** Distance from target in metres. */
    val distance: Float = 20f,
    /** Orbit target (metres, world space). */
    val targetX: Float = 0f,
    val targetY: Float = 1.2f,
    val targetZ: Float = 0f,
) {
    companion object {
        const val MIN_ELEVATION = -5f
        const val MAX_ELEVATION = 89.5f

        fun forMode(mode: ViewMode, radius: Float): CameraState {
            val d = radius * 2.6f
            return when (mode) {
                ViewMode.PLAN -> CameraState(mode, 0f, MAX_ELEVATION, d)
                ViewMode.ELEVATION_FRONT -> CameraState(mode, 0f, 2f, d)
                ViewMode.ELEVATION_SIDE -> CameraState(mode, 90f, 2f, d)
                ViewMode.ISOMETRIC -> CameraState(mode, 45f, 35.264f, d)
                ViewMode.PERSPECTIVE -> CameraState(mode, 30f, 22f, d * 0.8f)
            }
        }
    }

    fun eye(): FloatArray {
        val az = Math.toRadians(azimuthDeg.toDouble())
        val el = Math.toRadians(elevationDeg.toDouble())
        val horiz = (distance * cos(el)).toFloat()
        return floatArrayOf(
            targetX + horiz * sin(az).toFloat(),
            targetY + (distance * sin(el)).toFloat(),
            targetZ + horiz * cos(az).toFloat(),
        )
    }

    fun viewMatrix(): FloatArray {
        val e = eye()
        // Straight-down view needs an up vector that is not parallel to the view direction.
        val (ux, uy, uz) = if (elevationDeg > 85f) {
            Triple(-sin(Math.toRadians(azimuthDeg.toDouble())).toFloat(), 0f,
                -cos(Math.toRadians(azimuthDeg.toDouble())).toFloat())
        } else {
            Triple(0f, 1f, 0f)
        }
        return Mat4.lookAt(e[0], e[1], e[2], targetX, targetY, targetZ, ux, uy, uz)
    }

    fun projectionMatrix(aspect: Float): FloatArray {
        val far = distance * 6f + 50f
        return if (mode == ViewMode.PLAN || mode == ViewMode.ELEVATION_FRONT || mode == ViewMode.ELEVATION_SIDE) {
            // Technical views are orthographic, like a drawing sheet.
            val h = distance * 0.42f
            Mat4.ortho(-h * aspect, h * aspect, -h, h, 0.05f, far)
        } else {
            Mat4.perspective(45f, aspect, 0.05f, far)
        }
    }

    fun viewProjection(aspect: Float): FloatArray =
        Mat4.multiply(projectionMatrix(aspect), viewMatrix())

    fun orbited(dAzimuth: Float, dElevation: Float): CameraState = copy(
        mode = if (mode != ViewMode.PERSPECTIVE) ViewMode.PERSPECTIVE else mode,
        azimuthDeg = (azimuthDeg + dAzimuth) % 360f,
        elevationDeg = (elevationDeg + dElevation).coerceIn(MIN_ELEVATION, MAX_ELEVATION),
    )

    fun zoomed(factor: Float, minD: Float, maxD: Float): CameraState =
        copy(distance = (distance / factor).coerceIn(minD, maxD))

    /** Pans in screen space: right/up vectors derived from the current orbit. */
    fun panned(dxWorld: Float, dyWorld: Float): CameraState {
        val az = Math.toRadians(azimuthDeg.toDouble())
        val rightX = cos(az).toFloat(); val rightZ = -sin(az).toFloat()
        return copy(
            targetX = targetX - rightX * dxWorld,
            targetZ = targetZ - rightZ * dxWorld,
            targetY = (targetY + dyWorld).coerceIn(-5f, 30f),
        )
    }
}
