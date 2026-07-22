package com.floorplan3d.render

import android.annotation.SuppressLint
import android.content.Context
import android.opengl.GLSurfaceView
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import kotlin.math.abs

/**
 * GLSurfaceView wired for CAD-style navigation:
 *  - one-finger drag: orbit (rotate) the model
 *  - two-finger pinch: zoom
 *  - two-finger drag: pan
 *
 * The camera itself lives in the ViewModel ([onCameraChange] receives a
 * transformation of the current state) so Compose overlays stay in sync.
 */
@SuppressLint("ViewConstructor")
class PlanGLSurfaceView(
    context: Context,
    val renderer: PlanRenderer,
    private var modelRadius: Float,
    private val onCameraChange: ((CameraState) -> CameraState) -> Unit,
) : GLSurfaceView(context) {

    init {
        setEGLContextClientVersion(2)
        setRenderer(renderer)
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    fun setModelRadius(radius: Float) {
        modelRadius = radius
    }

    private var lastX = 0f
    private var lastY = 0f
    private var lastFocusX = 0f
    private var lastFocusY = 0f
    private var isScaling = false

    private val scaleDetector = ScaleGestureDetector(context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val factor = detector.scaleFactor
                if (abs(factor - 1f) > 0.001f) {
                    onCameraChange { it.zoomed(factor, modelRadius * 0.4f, modelRadius * 12f) }
                    requestRender()
                }
                return true
            }

            override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                isScaling = true
                return true
            }

            override fun onScaleEnd(detector: ScaleGestureDetector) {
                isScaling = false
            }
        })

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x; lastY = event.y
            }
            MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> {
                val (fx, fy) = focus(event)
                lastFocusX = fx; lastFocusY = fy
            }
            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount >= 2) {
                    val (fx, fy) = focus(event)
                    val dx = fx - lastFocusX
                    val dy = fy - lastFocusY
                    lastFocusX = fx; lastFocusY = fy
                    // Screen px → world metres, proportional to zoom level.
                    val worldPerPx = cameraWorldPerPixel()
                    onCameraChange { it.panned(dx * worldPerPx, dy * worldPerPx) }
                    requestRender()
                } else if (!isScaling) {
                    val dx = event.x - lastX
                    val dy = event.y - lastY
                    lastX = event.x; lastY = event.y
                    onCameraChange { it.orbited(dAzimuth = -dx * 0.4f, dElevation = dy * 0.3f) }
                    requestRender()
                }
            }
        }
        return true
    }

    private fun focus(event: MotionEvent): Pair<Float, Float> {
        var sx = 0f; var sy = 0f
        for (i in 0 until event.pointerCount) { sx += event.getX(i); sy += event.getY(i) }
        return sx / event.pointerCount to sy / event.pointerCount
    }

    private fun cameraWorldPerPixel(): Float {
        val distance = renderer.cameraRef.get().distance
        return distance / (height.coerceAtLeast(1)).toFloat()
    }
}
