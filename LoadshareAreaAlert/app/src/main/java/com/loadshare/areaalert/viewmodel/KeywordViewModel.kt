package com.loadshare.areaalert.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.data.SettingsRepository
import com.loadshare.areaalert.model.Keyword
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class KeywordViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository
) : ViewModel() {

    val keywords: StateFlow<List<Keyword>> = settingsRepository.keywords
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun addKeyword(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val trimmed = text.trim()
            val current = keywords.value
            if (current.any { it.text.equals(trimmed, ignoreCase = true) }) return@launch
            settingsRepository.addKeyword(Keyword(text = trimmed), current)
        }
    }

    fun removeKeyword(keywordId: String) = viewModelScope.launch {
        settingsRepository.removeKeyword(keywordId, keywords.value)
    }

    fun toggleKeyword(keywordId: String) = viewModelScope.launch {
        settingsRepository.toggleKeyword(keywordId, keywords.value)
    }
}
