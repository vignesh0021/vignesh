package com.floorplan3d

import android.app.Application
import android.util.Log
import com.floorplan3d.core.PlanLog
import com.floorplan3d.core.PlanLogger
import com.floorplan3d.data.db.PlanDatabase
import com.floorplan3d.data.repository.PlanRepository
import com.floorplan3d.data.repository.PriceRepository
import com.floorplan3d.domain.estimation.CostEstimator
import com.floorplan3d.domain.extraction.PlanExtractionPipeline
import com.floorplan3d.domain.extraction.PlanImageLoader
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Simple manual DI container — one graph, no code generation to break CI. */
class AppContainer(app: Application) {
    val database: PlanDatabase = PlanDatabase.build(app)
    val planRepository = PlanRepository(database.planDao())
    val priceRepository = PriceRepository(database.materialPriceDao())
    val extractionPipeline = PlanExtractionPipeline(PlanImageLoader(app))
    val costEstimator = CostEstimator()
}

class FloorPlanApp : Application() {

    lateinit var container: AppContainer
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        PlanLog.sink = object : PlanLogger {
            override fun d(tag: String, message: String) { Log.d(tag, message) }
            override fun w(tag: String, message: String) { Log.w(tag, message) }
            override fun e(tag: String, message: String, throwable: Throwable?) {
                Log.e(tag, message, throwable)
            }
        }
        container = AppContainer(this)
        appScope.launch {
            container.priceRepository.seedIfEmpty()
            container.priceRepository.refresh() // silent best-effort market update
        }
    }
}
