package com.loadshare.areaalert

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.loadshare.areaalert.license.LicenseStatus
import com.loadshare.areaalert.ui.screens.HistoryScreen
import com.loadshare.areaalert.ui.screens.HomeScreen
import com.loadshare.areaalert.ui.screens.KeywordScreen
import com.loadshare.areaalert.ui.screens.LicenseScreen
import com.loadshare.areaalert.ui.screens.ZoneScreen
import com.loadshare.areaalert.ui.theme.LoadshareAreaAlertTheme
import com.loadshare.areaalert.viewmodel.LicenseViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @OptIn(ExperimentalPermissionsApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            LoadshareAreaAlertTheme {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val notificationPermission = rememberPermissionState(
                        Manifest.permission.POST_NOTIFICATIONS
                    )
                    LaunchedEffect(Unit) {
                        if (!notificationPermission.status.isGranted) {
                            notificationPermission.launchPermissionRequest()
                        }
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // License gate: the whole app is locked behind a valid, non-expired
                    // per-device license. Until then only the activation screen is reachable.
                    val licenseViewModel: LicenseViewModel = hiltViewModel()
                    val licenseStatus by licenseViewModel.status.collectAsState()

                    if (licenseStatus is LicenseStatus.Active) {
                        val navController = rememberNavController()
                        NavHost(
                            navController = navController,
                            startDestination = "home"
                        ) {
                            composable("home") {
                                HomeScreen(
                                    onNavigateToKeywords = { navController.navigate("keywords") },
                                    onNavigateToZones = { navController.navigate("zones") },
                                    onNavigateToHistory = { navController.navigate("history") }
                                )
                            }
                            composable("keywords") {
                                KeywordScreen(onNavigateBack = { navController.popBackStack() })
                            }
                            composable("zones") {
                                ZoneScreen(onNavigateBack = { navController.popBackStack() })
                            }
                            composable("history") {
                                HistoryScreen(onNavigateBack = { navController.popBackStack() })
                            }
                        }
                    } else {
                        LicenseScreen(viewModel = licenseViewModel)
                    }
                }
            }
        }
    }
}
