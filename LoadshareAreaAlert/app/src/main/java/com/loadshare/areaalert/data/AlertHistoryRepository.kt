package com.loadshare.areaalert.data

import com.loadshare.areaalert.model.AlertRecord
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AlertHistoryRepository @Inject constructor(
    private val dataStoreManager: DataStoreManager
) {
    val history: Flow<List<AlertRecord>> = dataStoreManager.alertHistory

    suspend fun addRecord(record: AlertRecord) = dataStoreManager.addAlertRecord(record)
    suspend fun clearHistory() = dataStoreManager.clearAlertHistory()
}
