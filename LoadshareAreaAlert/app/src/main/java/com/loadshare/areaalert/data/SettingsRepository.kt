package com.loadshare.areaalert.data

import com.loadshare.areaalert.model.AppSettings
import com.loadshare.areaalert.model.Keyword
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val dataStoreManager: DataStoreManager
) {
    val appSettings: Flow<AppSettings> = dataStoreManager.appSettings
    val keywords: Flow<List<Keyword>> = dataStoreManager.keywords

    suspend fun setSoundEnabled(enabled: Boolean) = dataStoreManager.updateSoundEnabled(enabled)
    suspend fun setVibrationEnabled(enabled: Boolean) = dataStoreManager.updateVibrationEnabled(enabled)
    suspend fun setOverlayEnabled(enabled: Boolean) = dataStoreManager.updateOverlayEnabled(enabled)
    suspend fun setAlertVolume(volume: Float) = dataStoreManager.updateAlertVolume(volume)
    suspend fun setMonitoringActive(active: Boolean) = dataStoreManager.updateMonitoringActive(active)

    suspend fun addKeyword(keyword: Keyword, currentList: List<Keyword>) {
        val updated = currentList.toMutableList().apply { add(keyword) }
        dataStoreManager.saveKeywords(updated)
    }

    suspend fun removeKeyword(keywordId: String, currentList: List<Keyword>) {
        val updated = currentList.filter { it.id != keywordId }
        dataStoreManager.saveKeywords(updated)
    }

    suspend fun toggleKeyword(keywordId: String, currentList: List<Keyword>) {
        val updated = currentList.map { kw ->
            if (kw.id == keywordId) kw.copy(isEnabled = !kw.isEnabled) else kw
        }
        dataStoreManager.saveKeywords(updated)
    }

    suspend fun saveAllKeywords(keywords: List<Keyword>) = dataStoreManager.saveKeywords(keywords)
    suspend fun setOverlayDuration(seconds: Int) = dataStoreManager.updateOverlayDuration(seconds)
    suspend fun setRepeatAlertCount(count: Int) = dataStoreManager.updateRepeatAlertCount(count)
    suspend fun setAutoDismiss(enabled: Boolean) = dataStoreManager.updateAutoDismiss(enabled)
    suspend fun setMatchDropOnly(enabled: Boolean) = dataStoreManager.updateMatchDropOnly(enabled)
    suspend fun setMinAmount(rupees: Int) = dataStoreManager.updateMinAmount(rupees)
    suspend fun setMaxDistance(km: Int) = dataStoreManager.updateMaxDistance(km)
    suspend fun setWorkingHoursEnabled(enabled: Boolean) = dataStoreManager.updateWorkingHoursEnabled(enabled)
    suspend fun setWorkStartHour(hour: Int) = dataStoreManager.updateWorkStartHour(hour)
    suspend fun setWorkEndHour(hour: Int) = dataStoreManager.updateWorkEndHour(hour)
}
