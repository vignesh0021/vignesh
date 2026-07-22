package com.floorplan3d.domain.geometry

import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.domain.model.WallSegment
import kotlin.math.hypot

/**
 * 3D mesh generated from a [FloorPlan].
 *
 * World space is metres: X = plan east, Y = up, Z = plan south. The model is
 * centred on the origin so the orbit camera pivots around its middle.
 *
 * Vertex layout: interleaved px py pz nx ny nz r g b a (10 floats).
 */
data class PlanMesh(
    val vertices: FloatArray,
    val triangleIndices: ShortArray,
    val lineIndices: ShortArray,
    /** Anchors for on-screen labels: world position + text. */
    val labels: List<MeshLabel>,
    /** Model radius in metres — used to frame the camera. */
    val radius: Float,
)

data class MeshLabel(val x: Float, val y: Float, val z: Float, val text: String, val isElevation: Boolean)

/**
 * Extrudes plan walls into boxes and adds a floor slab. Pure Kotlin, deterministic,
 * unit-testable. Mesh sizes are tiny (a few hundred boxes at most), well within
 * Short index range, and build time is sub-millisecond — the "instant render"
 * budget is spent nowhere near here.
 */
object PlanMeshBuilder {

    /** One wall tint per storey so elevations read the building's floors at a glance. */
    private val WALL_COLORS = arrayOf(
        floatArrayOf(0.82f, 0.78f, 0.72f, 1f), // ground — warm sandstone
        floatArrayOf(0.72f, 0.79f, 0.85f, 1f), // first — light blue
        floatArrayOf(0.78f, 0.85f, 0.74f, 1f), // second — light green
        floatArrayOf(0.86f, 0.80f, 0.70f, 1f), // third — tan
    )
    private val FLOOR_COLOR = floatArrayOf(0.55f, 0.58f, 0.62f, 1f)

    fun build(plan: FloorPlan): PlanMesh {
        val verts = ArrayList<Float>(plan.walls.size * 24 * 10)
        val tris = ArrayList<Short>(plan.walls.size * 36)
        val lines = ArrayList<Short>(plan.walls.size * 24)
        val labels = ArrayList<MeshLabel>()

        // Centre the model: plan mm coordinates → centred metres.
        val cx = (plan.widthMm / 2000.0).toFloat()
        val cz = (plan.depthMm / 2000.0).toFloat()
        fun mx(mm: Double) = (mm / 1000.0).toFloat() - cx
        fun mz(mm: Double) = (mm / 1000.0).toFloat() - cz

        // One slab per storey; the ground slab's top face sits at Y=0.
        val slabT = (plan.floorThicknessMm / 1000.0).toFloat()
        val storeyH = (plan.wallHeightMm / 1000.0).toFloat()
        for (level in 0 until plan.floorCount.coerceAtLeast(1)) {
            val top = level * storeyH
            addBox(
                verts, tris, lines,
                mx(0.0), top - slabT, mz(0.0),
                mx(plan.widthMm), top, mz(plan.depthMm),
                FLOOR_COLOR,
            )
        }

        for (wall in plan.walls) {
            val half = (wall.thicknessMm / 2000.0).toFloat()
            val x1 = mx(minOf(wall.startXMm, wall.endXMm))
            val x2 = mx(maxOf(wall.startXMm, wall.endXMm))
            val z1 = mz(minOf(wall.startYMm, wall.endYMm))
            val z2 = mz(maxOf(wall.startYMm, wall.endYMm))
            val base = (wall.baseMm / 1000.0).toFloat()
            val top = base + (wall.heightMm / 1000.0).toFloat()
            val level = if (plan.wallHeightMm > 0) (wall.baseMm / plan.wallHeightMm).toInt() else 0
            val color = WALL_COLORS[level.coerceIn(0, WALL_COLORS.size - 1)]
            if (wall.isHorizontal) {
                addBox(verts, tris, lines, x1, base, z1 - half, x2, top, z1 + half, color)
            } else {
                addBox(verts, tris, lines, x1 - half, base, z1, x1 + half, top, z2, color)
            }
            // Dimension label floating above the wall midpoint (ground floor only,
            // to keep upper storeys readable).
            if (wall.baseMm == 0.0) {
                val midX = (x1 + x2) / 2f
                val midZ = (z1 + z2) / 2f
                labels += MeshLabel(midX, top + 0.15f, midZ, formatMetres(wall.lengthMm), isElevation = false)
            }
        }

        // Elevation labels stacked at the model's front-left corner.
        plan.elevations.distinctBy { it.label to it.valueMm }.forEachIndexed { i, mark ->
            labels += MeshLabel(
                mx(0.0), (mark.valueMm / 1000.0).toFloat().coerceAtLeast(0.05f) + i * 0.001f, mz(plan.depthMm),
                "${mark.label} ${"%+.2f".format(mark.valueMm / 1000.0)} m",
                isElevation = true,
            )
        }

        val radius = hypot(
            hypot((plan.widthMm / 2000.0), (plan.depthMm / 2000.0)),
            plan.wallHeightMm / 1000.0 * plan.floorCount.coerceAtLeast(1),
        ).toFloat().coerceAtLeast(1f)

        return PlanMesh(
            vertices = verts.toFloatArray(),
            triangleIndices = tris.toShortArray(),
            lineIndices = lines.toShortArray(),
            labels = labels,
            radius = radius,
        )
    }

    /** Appends an axis-aligned box with flat-shaded normals (24 vertices, 12 triangles). */
    private fun addBox(
        verts: ArrayList<Float>, tris: ArrayList<Short>, lines: ArrayList<Short>,
        x1: Float, y1: Float, z1: Float, x2: Float, y2: Float, z2: Float,
        color: FloatArray,
    ) {
        // Each face: 4 corners + outward normal, wound counter-clockwise from outside.
        val faces = arrayOf(
            // +Y top
            arrayOf(floatArrayOf(x1, y2, z1), floatArrayOf(x1, y2, z2), floatArrayOf(x2, y2, z2), floatArrayOf(x2, y2, z1), floatArrayOf(0f, 1f, 0f)),
            // -Y bottom
            arrayOf(floatArrayOf(x1, y1, z1), floatArrayOf(x2, y1, z1), floatArrayOf(x2, y1, z2), floatArrayOf(x1, y1, z2), floatArrayOf(0f, -1f, 0f)),
            // +X
            arrayOf(floatArrayOf(x2, y1, z1), floatArrayOf(x2, y2, z1), floatArrayOf(x2, y2, z2), floatArrayOf(x2, y1, z2), floatArrayOf(1f, 0f, 0f)),
            // -X
            arrayOf(floatArrayOf(x1, y1, z1), floatArrayOf(x1, y1, z2), floatArrayOf(x1, y2, z2), floatArrayOf(x1, y2, z1), floatArrayOf(-1f, 0f, 0f)),
            // +Z
            arrayOf(floatArrayOf(x1, y1, z2), floatArrayOf(x2, y1, z2), floatArrayOf(x2, y2, z2), floatArrayOf(x1, y2, z2), floatArrayOf(0f, 0f, 1f)),
            // -Z
            arrayOf(floatArrayOf(x1, y1, z1), floatArrayOf(x1, y2, z1), floatArrayOf(x2, y2, z1), floatArrayOf(x2, y1, z1), floatArrayOf(0f, 0f, -1f)),
        )
        for (face in faces) {
            val base = (verts.size / FLOATS_PER_VERTEX).toShort()
            val normal = face[4]
            for (i in 0 until 4) {
                val p = face[i]
                verts.add(p[0]); verts.add(p[1]); verts.add(p[2])
                verts.add(normal[0]); verts.add(normal[1]); verts.add(normal[2])
                verts.add(color[0]); verts.add(color[1]); verts.add(color[2]); verts.add(color[3])
            }
            tris.add(base); tris.add((base + 1).toShort()); tris.add((base + 2).toShort())
            tris.add(base); tris.add((base + 2).toShort()); tris.add((base + 3).toShort())
            lines.add(base); lines.add((base + 1).toShort())
            lines.add((base + 1).toShort()); lines.add((base + 2).toShort())
            lines.add((base + 2).toShort()); lines.add((base + 3).toShort())
            lines.add((base + 3).toShort()); lines.add(base)
        }
    }

    fun formatMetres(mm: Double): String = "%.2f m".format(mm / 1000.0)

    const val FLOATS_PER_VERTEX = 10

    /** Guard used by tests and the renderer: Short indices overflow past this many boxes. */
    fun fitsInShortIndices(wallCount: Int): Boolean = (wallCount + 1) * 24 <= Short.MAX_VALUE

    /** Trims a plan to the maximum wall count the mesh can index, longest walls first. */
    fun capWalls(walls: List<WallSegment>): List<WallSegment> {
        val maxWalls = Short.MAX_VALUE / 24 - 8 // reserve boxes for per-storey slabs
        return if (walls.size <= maxWalls) walls
        else walls.sortedByDescending { it.lengthMm }.take(maxWalls)
    }
}
