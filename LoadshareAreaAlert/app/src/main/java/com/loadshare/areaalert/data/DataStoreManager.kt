package com.loadshare.areaalert.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.loadshare.areaalert.model.AlertRecord
import com.loadshare.areaalert.model.AppSettings
import com.loadshare.areaalert.model.GeoZone
import com.loadshare.areaalert.model.Keyword
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "loadshare_prefs")

@Singleton
class DataStoreManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private object Keys {
        val SOUND_ENABLED = booleanPreferencesKey("sound_enabled")
        val VIBRATION_ENABLED = booleanPreferencesKey("vibration_enabled")
        val OVERLAY_ENABLED = booleanPreferencesKey("overlay_enabled")
        val ALERT_VOLUME = floatPreferencesKey("alert_volume")
        val IS_MONITORING_ACTIVE = booleanPreferencesKey("is_monitoring_active")
        val KEYWORDS_JSON = stringPreferencesKey("keywords_json")
        val ZONES_JSON = stringPreferencesKey("zones_json")
        val HISTORY_JSON = stringPreferencesKey("alert_history_json")
    }

    val appSettings: Flow<AppSettings> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { prefs ->
            AppSettings(
                soundEnabled = prefs[Keys.SOUND_ENABLED] ?: true,
                vibrationEnabled = prefs[Keys.VIBRATION_ENABLED] ?: true,
                overlayEnabled = prefs[Keys.OVERLAY_ENABLED] ?: true,
                alertVolume = prefs[Keys.ALERT_VOLUME] ?: 1.0f,
                isMonitoringActive = prefs[Keys.IS_MONITORING_ACTIVE] ?: false
            )
        }

    val keywords: Flow<List<Keyword>> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { prefs ->
            val json = prefs[Keys.KEYWORDS_JSON] ?: return@map getDefaultKeywords()
            parseKeywords(json)
        }

    suspend fun updateSoundEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.SOUND_ENABLED] = enabled }
    }

    suspend fun updateVibrationEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.VIBRATION_ENABLED] = enabled }
    }

    suspend fun updateOverlayEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.OVERLAY_ENABLED] = enabled }
    }

    suspend fun updateAlertVolume(volume: Float) {
        context.dataStore.edit { it[Keys.ALERT_VOLUME] = volume }
    }

    suspend fun updateMonitoringActive(active: Boolean) {
        context.dataStore.edit { it[Keys.IS_MONITORING_ACTIVE] = active }
    }

    suspend fun saveKeywords(keywords: List<Keyword>) {
        val json = JSONArray().apply {
            keywords.forEach { kw ->
                put(JSONObject().apply {
                    put("id", kw.id)
                    put("text", kw.text)
                    put("isEnabled", kw.isEnabled)
                })
            }
        }.toString()
        context.dataStore.edit { it[Keys.KEYWORDS_JSON] = json }
    }

    private fun parseKeywords(json: String): List<Keyword> {
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Keyword(
                    id = obj.getString("id"),
                    text = obj.getString("text"),
                    isEnabled = obj.getBoolean("isEnabled")
                )
            }
        } catch (e: Exception) {
            getDefaultKeywords()
        }
    }

    val geoZones: Flow<List<GeoZone>> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { prefs ->
            val json = prefs[Keys.ZONES_JSON] ?: return@map emptyList()
            parseGeoZones(json)
        }

    suspend fun saveGeoZones(zones: List<GeoZone>) {
        val json = JSONArray().apply {
            zones.forEach { zone ->
                put(JSONObject().apply {
                    put("id", zone.id)
                    put("name", zone.name)
                    put("lat", zone.lat)
                    put("lng", zone.lng)
                    put("radiusKm", zone.radiusKm)
                    put("isEnabled", zone.isEnabled)
                })
            }
        }.toString()
        context.dataStore.edit { it[Keys.ZONES_JSON] = json }
    }

    private fun parseGeoZones(json: String): List<GeoZone> {
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                GeoZone(
                    id = obj.getString("id"),
                    name = obj.getString("name"),
                    lat = obj.getDouble("lat"),
                    lng = obj.getDouble("lng"),
                    radiusKm = obj.getDouble("radiusKm"),
                    isEnabled = obj.getBoolean("isEnabled")
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    val alertHistory: Flow<List<AlertRecord>> = context.dataStore.data
        .catch { emit(emptyPreferences()) }
        .map { prefs -> parseAlertHistory(prefs[Keys.HISTORY_JSON] ?: return@map emptyList()) }

    suspend fun addAlertRecord(record: AlertRecord) {
        val current = alertHistory.first().toMutableList()
        current.add(0, record)
        if (current.size > 100) current.subList(100, current.size).clear()
        val json = JSONArray().apply {
            current.forEach { r ->
                put(JSONObject().apply {
                    put("id", r.id)
                    put("platform", r.platform)
                    put("keyword", r.keyword)
                    put("pickup", r.pickup)
                    put("drop", r.drop)
                    put("amount", r.amount)
                    put("distance", r.distance)
                    put("timestamp", r.timestamp)
                })
            }
        }.toString()
        context.dataStore.edit { it[Keys.HISTORY_JSON] = json }
    }

    suspend fun clearAlertHistory() {
        context.dataStore.edit { it.remove(Keys.HISTORY_JSON) }
    }

    private fun parseAlertHistory(json: String): List<AlertRecord> {
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                AlertRecord(
                    id = obj.getString("id"),
                    platform = obj.optString("platform", ""),
                    keyword = obj.getString("keyword"),
                    pickup = obj.getString("pickup"),
                    drop = obj.getString("drop"),
                    amount = obj.getString("amount"),
                    distance = obj.getString("distance"),
                    timestamp = obj.getLong("timestamp")
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    private fun getDefaultKeywords(): List<Keyword> = listOf(
        "ECR",
        "Neelankarai",
        "Injambakkam",
        "Akkarai",
        "Uthandi",
        "Sholinganallur",
        "Perungudi",
        "Thoraipakkam",
        "Palavakkam"
    ).map { Keyword(text = it, isEnabled = true) }
}
