package com.loadshare.areaalert.ui.screens

import android.app.Activity
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import com.loadshare.areaalert.license.LicenseStatus
import com.loadshare.areaalert.ui.theme.AlertBorder
import com.loadshare.areaalert.ui.theme.PrimaryGreen
import com.loadshare.areaalert.ui.theme.SuccessGreen
import com.loadshare.areaalert.ui.theme.WarningAmber
import com.loadshare.areaalert.viewmodel.HomeViewModel
import com.loadshare.areaalert.viewmodel.LicenseViewModel
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToKeywords: () -> Unit,
    onNavigateToZones: () -> Unit,
    onNavigateToHistory: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val settings by viewModel.appSettings.collectAsState()
    val serviceStale by viewModel.serviceStale.collectAsState()
    var accessibilityEnabled by remember { mutableStateOf(false) }
    var overlayPermissionGranted by remember { mutableStateOf(false) }
    var batteryOptEnabled by remember { mutableStateOf(false) }

    val alertToneName = remember(settings.alertSoundUri) {
        viewModel.getAlertToneName(settings.alertSoundUri)
    }
    val toneLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val uri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                result.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                result.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
            }
            viewModel.setAlertSoundUri(uri?.toString() ?: "")
        }
    }

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
            SubscriptionStatusRow()

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

            AnimatedVisibility(visible = serviceStale) {
                PermissionWarningCard(
                    title = "Service May Have Stopped",
                    message = "Monitoring is ON but no activity detected in the last 3 minutes. The service may have been killed. Re-enable it to resume protection.",
                    buttonText = "Re-enable Service",
                    icon = Icons.Default.Warning,
                    onAction = { viewModel.openAccessibilitySettings() }
                )
            }

            AlertSettingsCard(
                soundEnabled = settings.soundEnabled,
                vibrationEnabled = settings.vibrationEnabled,
                overlayEnabled = settings.overlayEnabled,
                alertVolume = settings.alertVolume,
                alertToneName = alertToneName,
                overlayDurationSeconds = settings.overlayDurationSeconds,
                repeatAlertCount = settings.repeatAlertCount,
                onSoundToggle = { viewModel.setSoundEnabled(it) },
                onVibrationToggle = { viewModel.setVibrationEnabled(it) },
                onOverlayToggle = { viewModel.setOverlayEnabled(it) },
                onVolumeChange = { viewModel.setAlertVolume(it) },
                onPickAlertTone = {
                    val existing = settings.alertSoundUri.takeIf { it.isNotBlank() }?.let(Uri::parse)
                        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                        putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALL)
                        putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Select Alert Tone")
                        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                        putExtra(
                            RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI,
                            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        )
                        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                        putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existing)
                    }
                    toneLauncher.launch(intent)
                },
                onOverlayDurationChange = { viewModel.setOverlayDuration(it) },
                onRepeatAlertCountChange = { viewModel.setRepeatAlertCount(it) }
            )

            SmartFilterCard(
                autoDismissEnabled = settings.autoDismissNonAreaOrders,
                matchDropOnly = settings.matchDropLocationOnly,
                autoAcceptEnabled = settings.autoAcceptEnabled,
                onAutoDismissToggle = { viewModel.setAutoDismiss(it) },
                onMatchDropOnlyToggle = { viewModel.setMatchDropOnly(it) },
                onAutoAcceptToggle = { viewModel.setAutoAccept(it) }
            )

            OrderFiltersCard(
                minAmountRupees = settings.minAmountRupees,
                maxDistanceKm = settings.maxDistanceKm,
                workingHoursEnabled = settings.workingHoursEnabled,
                workStartHour = settings.workStartHour,
                workEndHour = settings.workEndHour,
                onMinAmountChange = { viewModel.setMinAmount(it) },
                onMaxDistanceChange = { viewModel.setMaxDistance(it) },
                onWorkingHoursToggle = { viewModel.setWorkingHoursEnabled(it) },
                onWorkStartHourChange = { viewModel.setWorkStartHour(it) },
                onWorkEndHourChange = { viewModel.setWorkEndHour(it) }
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

// Compact subscription banner: shows days remaining and warns as expiry nears.
@Composable
private fun SubscriptionStatusRow(licenseViewModel: LicenseViewModel = hiltViewModel()) {
    val status by licenseViewModel.status.collectAsState()
    val active = status as? LicenseStatus.Active ?: return

    val daysLeft = (active.expiryEpochDay - LocalDate.now().toEpochDay()).coerceAtLeast(0)
    val nearExpiry = daysLeft <= 5
    val tint = if (nearExpiry) WarningAmber else SuccessGreen

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = tint.copy(alpha = 0.10f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.VerifiedUser, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    if (nearExpiry) "Subscription ending soon" else "Subscription active",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    "$daysLeft day${if (daysLeft == 1L) "" else "s"} left · expires ${licenseViewModel.expiryText(active.expiryEpochDay)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
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
    alertToneName: String,
    overlayDurationSeconds: Int,
    repeatAlertCount: Int,
    onSoundToggle: (Boolean) -> Unit,
    onVibrationToggle: (Boolean) -> Unit,
    onOverlayToggle: (Boolean) -> Unit,
    onVolumeChange: (Float) -> Unit,
    onPickAlertTone: () -> Unit,
    onOverlayDurationChange: (Int) -> Unit,
    onRepeatAlertCountChange: (Int) -> Unit
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

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Alert Tone",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                            )
                            Text(
                                alertToneName,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        OutlinedButton(
                            onClick = onPickAlertTone,
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(
                                Icons.Default.MusicNote,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Change", style = MaterialTheme.typography.labelMedium)
                        }
                    }
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

            AnimatedVisibility(visible = overlayEnabled) {
                Column(
                    modifier = Modifier.padding(start = 36.dp, top = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Overlay duration selector
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "Popup stays visible for",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(8 to "8s", 15 to "15s", 30 to "30s", 0 to "Manual").forEach { (secs, label) ->
                                FilterChip(
                                    selected = overlayDurationSeconds == secs,
                                    onClick = { onOverlayDurationChange(secs) },
                                    label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                                )
                            }
                        }
                    }

                    // Repeat alert selector
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "Re-alert if order missed",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(0 to "Off", 1 to "1×", 2 to "2×", 3 to "3×").forEach { (count, label) ->
                                FilterChip(
                                    selected = repeatAlertCount == count,
                                    onClick = { onRepeatAlertCountChange(count) },
                                    label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }
            }
        }
    }
}

@Composable
private fun SmartFilterCard(
    autoDismissEnabled: Boolean,
    matchDropOnly: Boolean,
    autoAcceptEnabled: Boolean,
    onAutoDismissToggle: (Boolean) -> Unit,
    onMatchDropOnlyToggle: (Boolean) -> Unit,
    onAutoAcceptToggle: (Boolean) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Smart Filter",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            SettingsToggleRow(
                icon = Icons.Default.FilterAlt,
                title = "Auto-dismiss Other Areas",
                subtitle = "Auto-skip non-area cards in order lists AND close popups that don't match your keywords",
                checked = autoDismissEnabled,
                onCheckedChange = onAutoDismissToggle
            )

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            SettingsToggleRow(
                icon = Icons.Default.LocationOn,
                title = "Match Delivery Area Only",
                subtitle = "Alert only when your keyword is in the DROP/delivery address — ignores ECR pickup → other area drop orders",
                checked = matchDropOnly,
                onCheckedChange = onMatchDropOnlyToggle
            )

            AnimatedVisibility(visible = matchDropOnly) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = PrimaryGreen.copy(alpha = 0.08f)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            Icons.Default.Info,
                            contentDescription = null,
                            tint = PrimaryGreen,
                            modifier = Modifier.size(16.dp).padding(top = 2.dp)
                        )
                        Text(
                            text = "Example: keyword \"ECR\" will alert for orders that DELIVER to ECR, but skip orders that only PICKUP from ECR and deliver elsewhere.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                        )
                    }
                }
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            SettingsToggleRow(
                icon = Icons.Default.FlashOn,
                title = "Auto-Accept Orders",
                subtitle = "Automatically tap Accept for preferred-area orders that pass your filters. Use with care.",
                checked = autoAcceptEnabled,
                onCheckedChange = onAutoAcceptToggle
            )

            AnimatedVisibility(visible = autoAcceptEnabled) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = WarningAmber.copy(alpha = 0.12f)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = WarningAmber,
                            modifier = Modifier.size(16.dp).padding(top = 2.dp)
                        )
                        Text(
                            text = "The app will TAKE these orders for you automatically. It only acts on single-order popups that match your keywords and pass the amount/distance filters — never on the list screen. Keep your keywords and filters tight.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderFiltersCard(
    minAmountRupees: Int,
    maxDistanceKm: Int,
    workingHoursEnabled: Boolean,
    workStartHour: Int,
    workEndHour: Int,
    onMinAmountChange: (Int) -> Unit,
    onMaxDistanceChange: (Int) -> Unit,
    onWorkingHoursToggle: (Boolean) -> Unit,
    onWorkStartHourChange: (Int) -> Unit,
    onWorkEndHourChange: (Int) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Order Filters",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            // ── Minimum amount ──────────────────────────────────────────
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.CurrencyRupee,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            "Minimum Amount",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Text(
                        text = if (minAmountRupees == 0) "Off" else "₹$minAmountRupees+",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (minAmountRupees == 0)
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                        else
                            MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    "Skip orders paying less than this amount",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
                )
                Slider(
                    value = minAmountRupees.toFloat(),
                    onValueChange = { onMinAmountChange(it.toInt()) },
                    valueRange = 0f..300f,
                    steps = 29,
                    modifier = Modifier.fillMaxWidth(),
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary
                    )
                )
            }

            HorizontalDivider()

            // ── Maximum distance ────────────────────────────────────────
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Route,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            "Maximum Distance",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Text(
                        text = if (maxDistanceKm == 0) "Off" else "≤ ${maxDistanceKm} km",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (maxDistanceKm == 0)
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                        else
                            MaterialTheme.colorScheme.primary
                    )
                }
                Text(
                    "Skip orders farther than this distance",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
                )
                Slider(
                    value = maxDistanceKm.toFloat(),
                    onValueChange = { onMaxDistanceChange(it.toInt()) },
                    valueRange = 0f..30f,
                    steps = 29,
                    modifier = Modifier.fillMaxWidth(),
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary
                    )
                )
            }

            HorizontalDivider()

            // ── Working hours ───────────────────────────────────────────
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Schedule,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Column {
                            Text(
                                "Working Hours",
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium
                            )
                            Text(
                                "Only monitor during these hours",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)
                            )
                        }
                    }
                    Switch(
                        checked = workingHoursEnabled,
                        onCheckedChange = onWorkingHoursToggle,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = MaterialTheme.colorScheme.primary
                        )
                    )
                }

                AnimatedVisibility(visible = workingHoursEnabled) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Start hour
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    "Start time",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                )
                                Text(
                                    formatHour(workStartHour),
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            Slider(
                                value = workStartHour.toFloat(),
                                onValueChange = { onWorkStartHourChange(it.toInt()) },
                                valueRange = 0f..23f,
                                steps = 22,
                                modifier = Modifier.fillMaxWidth(),
                                colors = SliderDefaults.colors(
                                    thumbColor = MaterialTheme.colorScheme.primary,
                                    activeTrackColor = MaterialTheme.colorScheme.primary
                                )
                            )
                        }
                        // End hour
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    "End time",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                )
                                Text(
                                    formatHour(workEndHour),
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            Slider(
                                value = workEndHour.toFloat(),
                                onValueChange = { onWorkEndHourChange(it.toInt()) },
                                valueRange = 0f..23f,
                                steps = 22,
                                modifier = Modifier.fillMaxWidth(),
                                colors = SliderDefaults.colors(
                                    thumbColor = MaterialTheme.colorScheme.primary,
                                    activeTrackColor = MaterialTheme.colorScheme.primary
                                )
                            )
                        }
                        // Summary
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                            ),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                text = "Monitoring active: ${formatHour(workStartHour)} – ${formatHour(workEndHour)}",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun formatHour(h: Int): String = when {
    h == 0 -> "12:00 AM"
    h < 12 -> "$h:00 AM"
    h == 12 -> "12:00 PM"
    else -> "${h - 12}:00 PM"
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
