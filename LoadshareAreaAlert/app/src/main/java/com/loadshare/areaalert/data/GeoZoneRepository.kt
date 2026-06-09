package com.loadshare.areaalert.data

import com.loadshare.areaalert.model.GeoZone
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GeoZoneRepository @Inject constructor(
    private val dataStoreManager: DataStoreManager
) {
    val zones: Flow<List<GeoZone>> = dataStoreManager.geoZones

    suspend fun addZone(zone: GeoZone) {
        val current = zones.first().toMutableList()
        current.add(zone)
        dataStoreManager.saveGeoZones(current)
    }

    suspend fun removeZone(id: String) {
        dataStoreManager.saveGeoZones(zones.first().filter { it.id != id })
    }

    suspend fun toggleZone(id: String) {
        dataStoreManager.saveGeoZones(
            zones.first().map { if (it.id == id) it.copy(isEnabled = !it.isEnabled) else it }
        )
    }
}
