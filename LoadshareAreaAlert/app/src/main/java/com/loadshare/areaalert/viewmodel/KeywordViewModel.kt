package com.loadshare.areaalert.viewmodel

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.data.SettingsRepository
import com.loadshare.areaalert.model.Keyword
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject

@HiltViewModel
class KeywordViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    val keywords: StateFlow<List<Keyword>> = settingsRepository.keywords
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // One-shot result message for export/import, shown as a snackbar
    private val _backupMessage = MutableStateFlow<String?>(null)
    val backupMessage: StateFlow<String?> = _backupMessage

    fun clearBackupMessage() { _backupMessage.value = null }

    fun addKeyword(text: String, isExclude: Boolean = false) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val trimmed = text.trim()
            val current = keywords.value
            if (current.any { it.text.equals(trimmed, ignoreCase = true) }) return@launch
            settingsRepository.addKeyword(Keyword(text = trimmed, isExclude = isExclude), current)
        }
    }

    fun removeKeyword(keywordId: String) = viewModelScope.launch {
        settingsRepository.removeKeyword(keywordId, keywords.value)
    }

    fun toggleKeyword(keywordId: String) = viewModelScope.launch {
        settingsRepository.toggleKeyword(keywordId, keywords.value)
    }

    fun toggleKeywordExclude(keywordId: String) = viewModelScope.launch {
        settingsRepository.toggleKeywordExclude(keywordId, keywords.value)
    }

    // Writes all keywords as JSON to a user-chosen file (ACTION_CREATE_DOCUMENT uri).
    // Same JSON shape as DataStoreManager so a backup can survive app reinstalls.
    fun exportKeywords(uri: Uri) = viewModelScope.launch(Dispatchers.IO) {
        try {
            val json = JSONArray().apply {
                keywords.value.forEach { kw ->
                    put(JSONObject().apply {
                        put("id", kw.id)
                        put("text", kw.text)
                        put("isEnabled", kw.isEnabled)
                        put("isExclude", kw.isExclude)
                    })
                }
            }.toString(2)
            context.contentResolver.openOutputStream(uri)?.use { out ->
                out.write(json.toByteArray())
            } ?: throw IllegalStateException("Cannot open output file")
            _backupMessage.value = "Exported ${keywords.value.size} keywords"
        } catch (e: Exception) {
            _backupMessage.value = "Export failed: ${e.message}"
        }
    }

    // Reads keywords from a backup file and MERGES them with the current list
    // (existing keywords with the same text are kept, not duplicated).
    fun importKeywords(uri: Uri) = viewModelScope.launch(Dispatchers.IO) {
        try {
            val json = context.contentResolver.openInputStream(uri)?.use { input ->
                input.readBytes().decodeToString()
            } ?: throw IllegalStateException("Cannot open file")

            val arr = JSONArray(json)
            val imported = (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Keyword(
                    id = obj.optString("id", java.util.UUID.randomUUID().toString()),
                    text = obj.getString("text"),
                    isEnabled = obj.optBoolean("isEnabled", true),
                    isExclude = obj.optBoolean("isExclude", false)
                )
            }
            val current = keywords.value
            val newOnes = imported.filter { imp ->
                current.none { it.text.equals(imp.text, ignoreCase = true) }
            }
            settingsRepository.saveAllKeywords(current + newOnes)
            _backupMessage.value = "Imported ${newOnes.size} new keywords (${imported.size - newOnes.size} already existed)"
        } catch (e: Exception) {
            _backupMessage.value = "Import failed: not a valid keyword backup file"
        }
    }
}
