package com.loadshare.areaalert.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.data.AlertHistoryRepository
import com.loadshare.areaalert.model.AlertRecord
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val alertHistoryRepository: AlertHistoryRepository
) : ViewModel() {

    val history: StateFlow<List<AlertRecord>> = alertHistoryRepository.history
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun clearHistory() = viewModelScope.launch { alertHistoryRepository.clearHistory() }
}
