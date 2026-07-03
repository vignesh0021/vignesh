package com.floorplan3d

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.floorplan3d.ui.HomeScreen
import com.floorplan3d.ui.ViewerScreen
import com.floorplan3d.ui.theme.FloorPlan3DTheme
import com.floorplan3d.viewmodel.HomeViewModel
import com.floorplan3d.viewmodel.ViewerViewModel

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as FloorPlanApp).container

        setContent {
            FloorPlan3DTheme {
                AppNavHost(container)
            }
        }
    }
}

@Composable
private fun AppNavHost(container: AppContainer) {
    val navController = rememberNavController()
    val factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = when (modelClass) {
            HomeViewModel::class.java ->
                HomeViewModel(container.extractionPipeline, container.planRepository) as T
            ViewerViewModel::class.java ->
                ViewerViewModel(container.planRepository, container.priceRepository, container.costEstimator) as T
            else -> throw IllegalArgumentException("Unknown ViewModel $modelClass")
        }
    }

    NavHost(navController = navController, startDestination = "home") {
        composable("home") {
            HomeScreen(
                viewModel = viewModel(factory = factory),
                onOpenPlan = { id -> navController.navigate("viewer/$id") },
            )
        }
        composable(
            route = "viewer/{planId}",
            arguments = listOf(navArgument("planId") { type = NavType.LongType }),
        ) { backStackEntry ->
            ViewerScreen(
                viewModel = viewModel(factory = factory),
                planId = backStackEntry.arguments?.getLong("planId") ?: -1L,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
