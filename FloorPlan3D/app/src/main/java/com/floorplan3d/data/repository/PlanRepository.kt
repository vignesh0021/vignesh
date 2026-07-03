package com.floorplan3d.data.repository

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.data.db.PlanDao
import com.floorplan3d.data.db.PlanEntity
import com.floorplan3d.domain.model.FloorPlan
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import java.io.File

/** A saved plan with its decoded extraction result. */
data class SavedPlan(
    val id: Long,
    val name: String,
    val createdAtMillis: Long,
    val sourceImagePath: String,
    val plan: FloorPlan,
)

/** Persists processed plans in Room; the FloorPlan is stored as JSON. */
class PlanRepository(
    private val dao: PlanDao,
    private val log: PlanLogger = PlanLog,
) {
    private val json = Json {
        ignoreUnknownKeys = true // forwards-compatible with schema evolution
        encodeDefaults = true
    }

    fun observePlans(): Flow<List<SavedPlan>> = dao.observeAll().map { entities ->
        entities.mapNotNull { decode(it) }
    }

    suspend fun getPlan(id: Long): SavedPlan? = dao.findById(id)?.let { decode(it) }

    suspend fun savePlan(plan: FloorPlan, sourceImage: File): Long {
        val entity = PlanEntity(
            name = plan.name,
            createdAtMillis = System.currentTimeMillis(),
            sourceImagePath = sourceImage.absolutePath,
            floorPlanJson = json.encodeToString(FloorPlan.serializer(), plan),
        )
        val id = dao.upsert(entity)
        log.d(TAG, "Saved plan \"${plan.name}\" as #$id")
        return id
    }

    suspend fun deletePlan(saved: SavedPlan) {
        dao.findById(saved.id)?.let { entity ->
            dao.delete(entity)
            runCatching { File(entity.sourceImagePath).delete() }
            log.d(TAG, "Deleted plan #${saved.id}")
        }
    }

    private fun decode(entity: PlanEntity): SavedPlan? = try {
        SavedPlan(
            id = entity.id,
            name = entity.name,
            createdAtMillis = entity.createdAtMillis,
            sourceImagePath = entity.sourceImagePath,
            plan = json.decodeFromString(FloorPlan.serializer(), entity.floorPlanJson),
        )
    } catch (e: Exception) {
        log.e(TAG, "Corrupted plan record #${entity.id}; skipping", e)
        null
    }

    companion object {
        private const val TAG = "PlanRepository"
    }
}
