package com.loadshare.areaalert.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.loadshare.areaalert.alert.GeocodingService
import com.loadshare.areaalert.data.GeoZoneRepository
import com.loadshare.areaalert.model.GeoZone
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class GeocodingState {
    object Idle : GeocodingState()
    object Loading : GeocodingState()
    object Success : GeocodingState()
    data class Error(val message: String) : GeocodingState()
}

@HiltViewModel
class ZoneViewModel @Inject constructor(
    private val geoZoneRepository: GeoZoneRepository,
    private val geocodingService: GeocodingService
) : ViewModel() {

    val zones: StateFlow<List<GeoZone>> = geoZoneRepository.zones
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    var geocodingState: GeocodingState by mutableStateOf(GeocodingState.Idle)
        private set

    fun addZone(zoneName: String, addressText: String, radiusKm: Double) {
        viewModelScope.launch {
            geocodingState = GeocodingState.Loading
            val location = geocodingService.geocode(addressText)
            if (location == null) {
                geocodingState = GeocodingState.Error(
                    "Location not found. Try a more specific address like \"Sholinganallur, Chennai\"."
                )
                return@launch
            }
            geoZoneRepository.addZone(
                GeoZone(
                    name = zoneName.trim(),
                    lat = location.lat,
                    lng = location.lng,
                    radiusKm = radiusKm
                )
            )
            geocodingState = GeocodingState.Success
        }
    }

    fun removeZone(id: String) = viewModelScope.launch { geoZoneRepository.removeZone(id) }
    fun toggleZone(id: String) = viewModelScope.launch { geoZoneRepository.toggleZone(id) }
    fun resetState() { geocodingState = GeocodingState.Idle }
}
