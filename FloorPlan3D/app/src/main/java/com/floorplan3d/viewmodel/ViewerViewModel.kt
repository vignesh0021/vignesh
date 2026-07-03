package com.floorplan3d.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.floorplan3d.data.repository.PlanRepository
import com.floorplan3d.data.repository.PriceRepository
import com.floorplan3d.data.repository.SavedPlan
import com.floorplan3d.domain.estimation.CostEstimator
import com.floorplan3d.domain.geometry.PlanMesh
import com.floorplan3d.domain.geometry.PlanMeshBuilder
import com.floorplan3d.domain.model.CostEstimate
import com.floorplan3d.render.CameraState
import com.floorplan3d.render.ViewMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class ViewerUiState(
    val loading: Boolean = true,
    val plan: SavedPlan? = null,
    val mesh: PlanMesh? = null,
    val estimate: CostEstimate? = null,
    val error: String? = null,
    val refreshingPrices: Boolean = false,
)

class ViewerViewModel(
    private val planRepository: PlanRepository,
    private val priceRepository: PriceRepository,
    private val costEstimator: CostEstimator,
) : ViewModel() {

    private val _state = MutableStateFlow(ViewerUiState())
    val state: StateFlow<ViewerUiState> = _state

    /** Compose state so label overlays recompose as the user navigates. */
    var camera by mutableStateOf(CameraState())
        private set

    fun load(planId: Long) {
        viewModelScope.launch {
            val saved = planRepository.getPlan(planId)
            if (saved == null) {
                _state.value = ViewerUiState(loading = false, error = "This plan could not be loaded.")
                return@launch
            }
            // Mesh building is fast (pure arithmetic) — safe on this dispatcher.
            val capped = saved.plan.copy(walls = PlanMeshBuilder.capWalls(saved.plan.walls))
            val mesh = PlanMeshBuilder.build(capped)
            camera = CameraState.forMode(ViewMode.ISOMETRIC, mesh.radius)
            _state.value = ViewerUiState(loading = false, plan = saved, mesh = mesh)
            recalculateCosts()
        }
    }

    fun updateCamera(transform: (CameraState) -> CameraState) {
        camera = transform(camera)
    }

    fun setViewMode(mode: ViewMode) {
        val radius = _state.value.mesh?.radius ?: 10f
        camera = CameraState.forMode(mode, radius)
    }

    fun refreshPrices() {
        _state.value = _state.value.copy(refreshingPrices = true)
        viewModelScope.launch {
            priceRepository.refresh()
            recalculateCosts()
            _state.value = _state.value.copy(refreshingPrices = false)
        }
    }

    private suspend fun recalculateCosts() {
        val saved = _state.value.plan ?: return
        val estimate = costEstimator.estimate(saved.plan, priceRepository.getPrices())
        _state.value = _state.value.copy(estimate = estimate)
    }
}
