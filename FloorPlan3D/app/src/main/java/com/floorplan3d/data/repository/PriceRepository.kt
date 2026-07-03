package com.floorplan3d.data.repository

import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.data.db.MaterialPriceDao
import com.floorplan3d.data.db.MaterialPriceEntity
import com.floorplan3d.domain.estimation.DefaultPriceCatalog
import com.floorplan3d.domain.estimation.MaterialPrice
import com.floorplan3d.domain.model.MaterialType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

/**
 * Material price source of truth:
 *  - seeded from [DefaultPriceCatalog] on first launch
 *  - user-visible values come from Room (survive offline)
 *  - [refresh] pulls current market prices from a JSON feed hosted with the
 *    repository, merging any materials it knows about
 */
class PriceRepository(
    private val dao: MaterialPriceDao,
    private val feedUrl: String = DEFAULT_FEED_URL,
    private val log: PlanLogger = PlanLog,
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class RemotePrice(val pricePerUnit: Double, val source: String = "Market feed")

    fun observePrices(): Flow<Map<MaterialType, MaterialPrice>> =
        dao.observeAll().map { entities -> merge(entities) }

    suspend fun getPrices(): Map<MaterialType, MaterialPrice> = merge(dao.getAll())

    suspend fun seedIfEmpty() {
        if (dao.getAll().isEmpty()) {
            val defaults = DefaultPriceCatalog.prices()
            dao.upsertAll(defaults.values.map { it.toEntity() })
            log.d(TAG, "Seeded ${defaults.size} default material prices")
        }
    }

    /** Fetches the remote feed; returns true when prices were updated. Never throws. */
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) {
        try {
            val connection = URL(feedUrl).openConnection() as HttpURLConnection
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            val body = connection.inputStream.use { it.readBytes().decodeToString() }
            val remote = json.decodeFromString(
                MapSerializer(String.serializer(), RemotePrice.serializer()), body)
            val now = System.currentTimeMillis()
            val updates = remote.mapNotNull { (name, rp) ->
                val material = MaterialType.entries.firstOrNull { it.name == name } ?: return@mapNotNull null
                if (rp.pricePerUnit <= 0) return@mapNotNull null
                MaterialPriceEntity(material.name, rp.pricePerUnit, material.unit, now, rp.source)
            }
            if (updates.isEmpty()) {
                log.w(TAG, "Price feed returned no recognisable materials")
                return@withContext false
            }
            dao.upsertAll(updates)
            log.d(TAG, "Refreshed ${updates.size} prices from feed")
            true
        } catch (e: Exception) {
            log.w(TAG, "Price refresh failed (offline?): ${e.message}")
            false
        }
    }

    /** DB rows merged over defaults, so a missing row never leaves a material unpriced. */
    private fun merge(entities: List<MaterialPriceEntity>): Map<MaterialType, MaterialPrice> {
        val result = DefaultPriceCatalog.prices().toMutableMap()
        for (e in entities) {
            val material = MaterialType.entries.firstOrNull { it.name == e.material } ?: continue
            result[material] = MaterialPrice(material, e.pricePerUnit, e.unit, e.updatedAtMillis, e.source)
        }
        return result
    }

    private fun MaterialPrice.toEntity() =
        MaterialPriceEntity(material.name, pricePerUnit, unit, updatedAtMillis, source)

    companion object {
        private const val TAG = "PriceRepository"
        const val DEFAULT_FEED_URL =
            "https://raw.githubusercontent.com/vignesh0021/vignesh/main/FloorPlan3D/pricing/material-prices.json"
    }
}
