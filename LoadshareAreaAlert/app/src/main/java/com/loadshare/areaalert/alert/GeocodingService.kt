package com.loadshare.areaalert.alert

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton

data class LatLng(val lat: Double, val lng: Double)

@Singleton
class GeocodingService @Inject constructor() {

    suspend fun geocode(address: String): LatLng? = withContext(Dispatchers.IO) {
        try {
            val query = URLEncoder.encode(address.trim(), "UTF-8")
            val url = URL("https://nominatim.openstreetmap.org/search?q=$query&format=json&limit=1&countrycodes=in")
            val conn = url.openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "LoadshareAreaAlert/1.0")
            conn.connectTimeout = 6000
            conn.readTimeout = 6000
            if (conn.responseCode != 200) return@withContext null
            val json = conn.inputStream.bufferedReader().readText()
            val arr = JSONArray(json)
            if (arr.length() == 0) return@withContext null
            val obj = arr.getJSONObject(0)
            LatLng(obj.getString("lat").toDouble(), obj.getString("lon").toDouble())
        } catch (_: Exception) {
            null
        }
    }
}
