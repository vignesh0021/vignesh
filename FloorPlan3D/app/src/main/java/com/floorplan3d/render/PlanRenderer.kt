package com.floorplan3d.render

import android.opengl.GLES20
import android.opengl.GLSurfaceView
import com.floorplan3d.core.PlanLog
import com.floorplan3d.domain.geometry.PlanMesh
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer
import java.util.concurrent.atomic.AtomicReference
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * OpenGL ES 2.0 renderer for the extruded floor-plan mesh.
 *
 * Deliberately dependency-free and simple: one interleaved VBO, one shader with
 * per-vertex colour + hemispheric directional lighting, and a wireframe pass for
 * crisp edges. A few thousand triangles renders in well under a millisecond on
 * any GLES2 device, so interaction is always fluid on mid-range hardware.
 *
 * RENDERMODE_WHEN_DIRTY: frames are only drawn when the camera or mesh changes,
 * saving battery while staying instant.
 */
class PlanRenderer : GLSurfaceView.Renderer {

    /** Written from the UI thread, read on the GL thread. */
    val cameraRef = AtomicReference(CameraState())

    private val pendingMesh = AtomicReference<PlanMesh?>(null)

    private var program = 0
    private var aPosition = 0
    private var aNormal = 0
    private var aColor = 0
    private var uMvp = 0
    private var uLightDir = 0
    private var uColorOverride = 0

    private var vertexBuffer: FloatBuffer? = null
    private var triBuffer: ShortBuffer? = null
    private var lineBuffer: ShortBuffer? = null
    private var triCount = 0
    private var lineCount = 0

    @Volatile private var aspect = 1f

    fun setMesh(mesh: PlanMesh) {
        pendingMesh.set(mesh)
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0.96f, 0.96f, 0.97f, 1f)
        GLES20.glEnable(GLES20.GL_DEPTH_TEST)
        GLES20.glEnable(GLES20.GL_CULL_FACE)
        GLES20.glCullFace(GLES20.GL_BACK)

        program = buildProgram()
        aPosition = GLES20.glGetAttribLocation(program, "aPosition")
        aNormal = GLES20.glGetAttribLocation(program, "aNormal")
        aColor = GLES20.glGetAttribLocation(program, "aColor")
        uMvp = GLES20.glGetUniformLocation(program, "uMvp")
        uLightDir = GLES20.glGetUniformLocation(program, "uLightDir")
        uColorOverride = GLES20.glGetUniformLocation(program, "uColorOverride")
        PlanLog.d(TAG, "GL surface created; shader program=$program")
        // Surface (and GL context) may be recreated after backgrounding: re-upload.
        uploadedMesh?.let { pendingMesh.compareAndSet(null, it) }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        aspect = if (height == 0) 1f else width.toFloat() / height
    }

    private var uploadedMesh: PlanMesh? = null

    override fun onDrawFrame(gl: GL10?) {
        pendingMesh.getAndSet(null)?.let { upload(it) }

        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val vb = vertexBuffer ?: return
        val camera = cameraRef.get()
        val mvp = camera.viewProjection(aspect)

        GLES20.glUseProgram(program)
        GLES20.glUniformMatrix4fv(uMvp, 1, false, mvp, 0)
        GLES20.glUniform3f(uLightDir, 0.35f, 0.85f, 0.4f)

        val stride = 10 * 4
        vb.position(0)
        GLES20.glVertexAttribPointer(aPosition, 3, GLES20.GL_FLOAT, false, stride, vb)
        GLES20.glEnableVertexAttribArray(aPosition)
        vb.position(3)
        GLES20.glVertexAttribPointer(aNormal, 3, GLES20.GL_FLOAT, false, stride, vb)
        GLES20.glEnableVertexAttribArray(aNormal)
        vb.position(6)
        GLES20.glVertexAttribPointer(aColor, 4, GLES20.GL_FLOAT, false, stride, vb)
        GLES20.glEnableVertexAttribArray(aColor)

        // Solid pass.
        GLES20.glUniform4f(uColorOverride, 0f, 0f, 0f, 0f)
        triBuffer?.let {
            it.position(0)
            GLES20.glDrawElements(GLES20.GL_TRIANGLES, triCount, GLES20.GL_UNSIGNED_SHORT, it)
        }
        // Wireframe pass for edge definition.
        GLES20.glUniform4f(uColorOverride, 0.15f, 0.17f, 0.22f, 1f)
        lineBuffer?.let {
            it.position(0)
            GLES20.glDrawElements(GLES20.GL_LINES, lineCount, GLES20.GL_UNSIGNED_SHORT, it)
        }

        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aNormal)
        GLES20.glDisableVertexAttribArray(aColor)
    }

    private fun upload(mesh: PlanMesh) {
        vertexBuffer = ByteBuffer.allocateDirect(mesh.vertices.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer().put(mesh.vertices).apply { position(0) }
        triBuffer = ByteBuffer.allocateDirect(mesh.triangleIndices.size * 2)
            .order(ByteOrder.nativeOrder()).asShortBuffer().put(mesh.triangleIndices).apply { position(0) }
        lineBuffer = ByteBuffer.allocateDirect(mesh.lineIndices.size * 2)
            .order(ByteOrder.nativeOrder()).asShortBuffer().put(mesh.lineIndices).apply { position(0) }
        triCount = mesh.triangleIndices.size
        lineCount = mesh.lineIndices.size
        uploadedMesh = mesh
        PlanLog.d(TAG, "Mesh uploaded: ${mesh.vertices.size / 10} vertices, ${triCount / 3} triangles")
    }

    private fun buildProgram(): Int {
        val vs = """
            uniform mat4 uMvp;
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            attribute vec4 aColor;
            varying vec4 vColor;
            varying vec3 vNormal;
            void main() {
                gl_Position = uMvp * vec4(aPosition, 1.0);
                vColor = aColor;
                vNormal = aNormal;
            }
        """.trimIndent()
        val fs = """
            precision mediump float;
            uniform vec3 uLightDir;
            uniform vec4 uColorOverride;
            varying vec4 vColor;
            varying vec3 vNormal;
            void main() {
                if (uColorOverride.a > 0.5) {
                    gl_FragColor = uColorOverride;
                } else {
                    float diffuse = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
                    float light = 0.55 + 0.45 * diffuse;
                    gl_FragColor = vec4(vColor.rgb * light, vColor.a);
                }
            }
        """.trimIndent()

        val v = compile(GLES20.GL_VERTEX_SHADER, vs)
        val f = compile(GLES20.GL_FRAGMENT_SHADER, fs)
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, v)
        GLES20.glAttachShader(p, f)
        GLES20.glLinkProgram(p)
        val status = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, status, 0)
        if (status[0] == 0) {
            val info = GLES20.glGetProgramInfoLog(p)
            PlanLog.e(TAG, "Shader link failed: $info")
        }
        return p
    }

    private fun compile(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) {
            PlanLog.e(TAG, "Shader compile failed: ${GLES20.glGetShaderInfoLog(shader)}")
        }
        return shader
    }

    companion object {
        private const val TAG = "PlanRenderer"
    }
}
