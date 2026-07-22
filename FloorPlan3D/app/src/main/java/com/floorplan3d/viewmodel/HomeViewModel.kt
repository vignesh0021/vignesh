package com.floorplan3d.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.floorplan3d.core.PlanLog
import com.floorplan3d.data.repository.PlanRepository
import com.floorplan3d.data.repository.SavedPlan
import com.floorplan3d.domain.extraction.ExtractionStage
import com.floorplan3d.domain.extraction.PlanExtractionPipeline
import com.floorplan3d.domain.extraction.PlanImageException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Import progress shown as a modal while a plan is processed. */
sealed interface ImportState {
    data object Idle : ImportState
    data class Processing(val stage: ExtractionStage) : ImportState
    data class Done(val planId: Long) : ImportState
    data class Failed(val message: String) : ImportState
}

class HomeViewModel(
    private val pipeline: PlanExtractionPipeline,
    private val planRepository: PlanRepository,
) : ViewModel() {

    val plans: StateFlow<List<SavedPlan>> = planRepository.observePlans()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _importState = MutableStateFlow<ImportState>(ImportState.Idle)
    val importState: StateFlow<ImportState> = _importState

    fun importPlan(uri: Uri, name: String) {
        if (_importState.value is ImportState.Processing) return
        _importState.value = ImportState.Processing(ExtractionStage.LOADING)
        viewModelScope.launch {
            try {
                val output = pipeline.extract(uri, name) { stage ->
                    _importState.value = ImportState.Processing(stage)
                }
                val id = planRepository.savePlan(output.plan, output.sourceImage)
                _importState.value = ImportState.Done(id)
            } catch (e: PlanImageException) {
                PlanLog.w(TAG, "Import rejected: ${e.message}")
                _importState.value = ImportState.Failed(e.message ?: "The file could not be processed.")
            } catch (e: Exception) {
                PlanLog.e(TAG, "Import failed unexpectedly", e)
                _importState.value = ImportState.Failed(
                    "Something went wrong while processing the plan. Please try another image.")
            }
        }
    }

    fun deletePlan(plan: SavedPlan) {
        viewModelScope.launch { planRepository.deletePlan(plan) }
    }

    fun acknowledgeImport() {
        _importState.value = ImportState.Idle
    }

    companion object {
        private const val TAG = "HomeViewModel"
    }
}
