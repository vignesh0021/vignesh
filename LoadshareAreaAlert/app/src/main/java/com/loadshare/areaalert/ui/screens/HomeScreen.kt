package com.loadshare.areaalert.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.loadshare.areaalert.ui.theme.AlertBorder
import com.loadshare.areaalert.ui.theme.PrimaryGreen
import com.loadshare.areaalert.ui.theme.SuccessGreen
import com.loadshare.areaalert.ui.theme.WarningAmber
import com.loadshare.areaalert.viewmodel.HomeViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToKeywords: () -> Unit,
    onNavigateToZones: () -> Unit,
    onNavigateToHistory: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val settings by viewModel.appSettings.collectAsState()
    var accessibilityEnabled by remember { mutableStateOf(false) }
    var overlayPermissionGranted by remember { mutableStateOf(false) }
    var batteryOptEnabled by remember { mutableStateOf(false) }

    // Refresh permission states every time the screen becomes visible
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner.lifecycle) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            accessibilityEnabled = viewModel.isAccessibilityServiceEnabled()
            overlayPermissionGranted = viewModel.canDrawOverlays()
            batteryOptEnabled = viewModel.isBatteryOptimizationEnabled()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Loadshare Area Alert",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Order Location Monitor",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary
                ),
                actions = {
                    IconButton(onClick = onNavigateToKeywords) {
                        Icon(
                            Icons.Default.List,
                            contentDescription = "Keywords",
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            MonitoringStatusCard(
                isMonitoringActive = settings.isMonitoringActive,
                accessibilityEnabled = accessibilityEnabled,
                onToggleMonitoring = { viewModel.setMonitoringActive(it) }
            )

            AnimatedVisibility(visible = !accessibilityEnabled) {
                PermissionWarningCard(
                    title = "Accessibility Service Required",
                    message = "Enable the Loadshare Area Alert accessibility service to monitor screen content.",
                    buttonText = "Enable Accessibility",
                    icon = Icons.Default.AccessibilityNew,
                    onAction = {
                        viewModel.openAccessibilitySettings()
                        accessibilityEnabled = viewModel.isAccessibilityServiceEnabled()
                    }
                )
            }

            AnimatedVisibility(visible = !overlayPermissionGranted) {
                PermissionWarningCard(
                    title = "Overlay Permission Required",
                    message = "Grant overlay permission to display floating alerts when orders are found.",
                    buttonText = "Grant Permission",
                    icon = Icons.Default.Layers,
                    onAction = {
                        viewModel.openOverlaySettings()
                        overlayPermissionGranted = viewModel.canDrawOverlays()
                    }
                )
            }

            AnimatedVisibility(visible = batteryOptEnabled) {
                PermissionWarningCard(
                    title = "Battery Optimization Active",
                    message = "Your phone may kill the monitoring service in background. Disable battery optimization for reliable alerts.",
                    buttonText = "Disable Now",
                    icon = Icons.Default.BatteryAlert,
                    onAction = {
                        viewModel.openBatteryOptimizationSettings()
                        batteryOptEnabled = viewModel.isBatteryOptimizationEnabled()
                    }
                )
            }

            AlertSettingsCard(
                soundEnabled = settings.soundEnabled,
                vibrationEnabled = settings.vibrationEnabled,
                overlayEnabled = settings.overlayEnabled,
                alertVolume = settings.alertVolume,
                onSoundToggle = { viewModel.setSoundEnabled(it) },
                onVibrationToggle = { viewModel.setVibrationEnabled(it) },
                onOverlayToggle = { viewModel.setOverlayEnabled(it) },
                onVolumeChange = { viewModel.setAlertVolume(it) }
            )

            QuickActionsCard(
                onNavigateToKeywords = onNavigateToKeywords,
                onNavigateToZones = onNavigateToZones,
                onNavigateToHistory = onNavigateToHistory,
                onTestAlert = { viewModel.triggerTestAlert() }
            )

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun MonitoringStatusCard(
    isMonitoringActive: Boolean,
    accessibilityEnabled: Boolean,
    onToggleMonitoring: (Boolean) -> Unit
) {
    val statusColor = when {
        isMonitoringActive && accessibilityEnabled -> SuccessGreen
        else -> WarningAmber
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primaryContainer,
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
                        )
                    )
                )
                .padding(20.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Text(
                            text = if (isMonitoringActive && accessibilityEnabled) "Monitoring Active" else "Monitoring Inactive",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                    Switch(
                        checked = isMonitoringActive,
                        onCheckedChange = onToggleMonitoring,
                        enabled = accessibilityEnabled,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = SuccessGreen,
                            checkedTrackColor = SuccessGreen.copy(alpha = 0.3f)
                        )
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = when {
                        !accessibilityEnabled -> "Accessibility service not enabled"
                        isMonitoringActive -> "Scanning screen for preferred area orders..."
                        else -> "Toggle to start monitoring for orders"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
        }
    }
}

@Composable
private fun PermissionWarningCard(
    title: String,
    message: String,
    buttonText: String,
    icon: ImageVector,
    onAction: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, WarningAmber, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = WarningAmber.copy(alpha = 0.1f)
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = WarningAmber,
                modifier = Modifier.size(24.dp)
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
                Button(
                    onClick = onAction,
                    colors = ButtonDefaults.buttonColors(containerColor = WarningAmber),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(buttonText, color = Color.Black, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun AlertSettingsCard(
    soundEnabled: Boolean,
    vibrationEnabled: Boolean,
    overlayEnabled: Boolean,
    alertVolume: Float,
    onSoundToggle: (Boolean) -> Unit,
    onVibrationToggle: (Boolean) -> Unit,
    onOverlayToggle: (Boolean) -> Unit,
    onVolumeChange: (Float) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "Alert Settings",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))

            SettingsToggleRow(
                icon = Icons.Default.VolumeUp,
                title = "Sound Alert",
                subtitle = "Play notification sound when order found",
                checked = soundEnabled,
                onCheckedChange = onSoundToggle
            )
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            AnimatedVisibility(visible = soundEnabled) {
                Column(modifier = Modifier.padding(start = 36.dp, bottom = 8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            "Alert Volume",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                        )
                        Text(
                            "${(alertVolume * 100).toInt()}%",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    Slider(
                        value = alertVolume,
                        onValueChange = onVolumeChange,
                        modifier = Modifier.fillMaxWidth(),
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.primary,
                            activeTrackColor = MaterialTheme.colorScheme.primary
                        )
                    )
                }
            }

            SettingsToggleRow(
                icon = Icons.Default.Vibration,
                title = "Vibration Alert",
                subtitle = "Vibrate device when order found",
                checked = vibrationEnabled,
                onCheckedChange = onVibrationToggle
            )
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            SettingsToggleRow(
                icon = Icons.Default.Layers,
                title = "Overlay Alert",
                subtitle = "Show floating popup when order found",
                checked = overlayEnabled,
                onCheckedChange = onOverlayToggle
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(24.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.primary
            )
        )
    }
}

@Composable
private fun QuickActionsCard(
    onNavigateToKeywords: () -> Unit,
    onNavigateToZones: () -> Unit,
    onNavigateToHistory: () -> Unit,
    onTestAlert: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Quick Actions",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            OutlinedButton(
                onClick = onNavigateToKeywords,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(Icons.Default.LocationOn, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Manage Location Keywords")
            }
            OutlinedButton(
                onClick = onNavigateToZones,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(Icons.Default.MyLocation, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Manage GPS Geo Zones")
            }
            OutlinedButton(
                onClick = onNavigateToHistory,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(Icons.Default.History, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Alert History")
            }
            Button(
                onClick = onTestAlert,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(Icons.Default.NotificationsActive, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Test Alert")
            }
        }
    }
}
