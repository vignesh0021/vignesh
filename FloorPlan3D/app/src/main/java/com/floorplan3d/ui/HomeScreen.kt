package com.floorplan3d.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.outlined.Architecture
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.floorplan3d.core.PlanLog
import com.floorplan3d.data.repository.SavedPlan
import com.floorplan3d.viewmodel.HomeViewModel
import com.floorplan3d.viewmodel.ImportState
import java.io.File
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenPlan: (Long) -> Unit,
) {
    val plans by viewModel.plans.collectAsState()
    val importState by viewModel.importState.collectAsState()
    val context = LocalContext.current

    var captureUri by remember { mutableStateOf<Uri?>(null) }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        uri?.let { viewModel.importPlan(it, "Plan ${DateFormat.getDateTimeInstance().format(Date())}") }
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = captureUri
        if (success && uri != null) {
            viewModel.importPlan(uri, "Site capture ${DateFormat.getDateTimeInstance().format(Date())}")
        }
    }

    LaunchedEffect(importState) {
        val done = importState as? ImportState.Done ?: return@LaunchedEffect
        viewModel.acknowledgeImport()
        onOpenPlan(done.planId)
    }

    var showDiagnostics by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("FloorPlan 3D") },
                actions = {
                    IconButton(onClick = { showDiagnostics = true }) {
                        Icon(Icons.Outlined.BugReport, contentDescription = "Extraction diagnostics")
                    }
                },
            )
        },
        floatingActionButton = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SmallFloatingActionButton(onClick = {
                    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
                    val file = File(dir, "capture_${System.currentTimeMillis()}.jpg")
                    val uri = FileProvider.getUriForFile(
                        context, "${context.packageName}.fileprovider", file)
                    captureUri = uri
                    cameraLauncher.launch(uri)
                }) {
                    Icon(Icons.Default.PhotoCamera, contentDescription = "Capture plan with camera")
                }
                ExtendedFloatingActionButton(
                    onClick = { filePicker.launch(arrayOf("image/png", "image/jpeg", "application/pdf")) },
                    icon = { Icon(Icons.Default.UploadFile, contentDescription = null) },
                    text = { Text("Upload plan") },
                )
            }
        },
    ) { padding ->
        if (plans.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Outlined.Architecture, contentDescription = null,
                    modifier = Modifier.size(72.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    "Upload a 2D floor plan (PDF, PNG or JPG) and see it as an interactive 3D model " +
                        "with dimensions, elevations and a live material cost estimate.",
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(plans, key = { it.id }) { plan ->
                    PlanCard(plan, onOpen = { onOpenPlan(plan.id) }, onDelete = { viewModel.deletePlan(plan) })
                }
            }
        }
    }

    if (showDiagnostics) {
        DiagnosticsDialog(onDismiss = { showDiagnostics = false })
    }

    when (val state = importState) {
        is ImportState.Processing -> {
            AlertDialog(
                onDismissRequest = {},
                confirmButton = {},
                title = { Text("Processing plan") },
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                        Spacer(Modifier.size(16.dp))
                        Text(state.stage.label)
                    }
                },
            )
        }
        is ImportState.Failed -> {
            AlertDialog(
                onDismissRequest = { viewModel.acknowledgeImport() },
                confirmButton = {
                    TextButton(onClick = { viewModel.acknowledgeImport() }) { Text("OK") }
                },
                title = { Text("Could not process plan") },
                text = { Text(state.message) },
            )
        }
        else -> Unit
    }
}

/**
 * Read-only view of the extraction log ring buffer — lets users share exactly
 * what OCR read and how walls/scale were resolved when a plan looks wrong.
 */
@Composable
private fun DiagnosticsDialog(onDismiss: () -> Unit) {
    val entries = remember { PlanLog.entries.asReversed() }
    val timeFormat = remember { java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US) }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        },
        title = { Text("Extraction diagnostics") },
        text = {
            if (entries.isEmpty()) {
                Text("No log entries yet. Upload a plan first.")
            } else {
                SelectionContainer {
                    LazyColumn(modifier = Modifier.height(420.dp)) {
                        items(entries.size) { i ->
                            val e = entries[i]
                            Text(
                                "${timeFormat.format(Date(e.timeMillis))} ${e.level}/${e.tag}: ${e.message}",
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 10.sp,
                                lineHeight = 13.sp,
                            )
                        }
                    }
                }
            }
        },
    )
}

@Composable
private fun PlanCard(plan: SavedPlan, onOpen: () -> Unit, onDelete: () -> Unit) {
    Card(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(plan.name, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    "%.1f × %.1f m · %d walls · %s".format(
                        plan.plan.widthMm / 1000, plan.plan.depthMm / 1000,
                        plan.plan.walls.size,
                        DateFormat.getDateInstance().format(Date(plan.createdAtMillis)),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete ${plan.name}")
            }
        }
    }
}
