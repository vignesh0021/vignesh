package com.floorplan3d.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.floorplan3d.domain.geometry.Mat4
import com.floorplan3d.domain.geometry.PlanMesh
import com.floorplan3d.domain.model.CostEstimate
import com.floorplan3d.domain.model.FloorPlan
import com.floorplan3d.render.CameraState
import com.floorplan3d.render.PlanGLSurfaceView
import com.floorplan3d.render.PlanRenderer
import com.floorplan3d.render.ViewMode
import com.floorplan3d.viewmodel.ViewerViewModel
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(
    viewModel: ViewerViewModel,
    planId: Long,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(planId) { viewModel.load(planId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.plan?.name ?: "Plan viewer", maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            state.error != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(state.error!!, style = MaterialTheme.typography.bodyLarge)
            }
            else -> {
                val plan = state.plan!!.plan
                val mesh = state.mesh!!
                Column(Modifier.fillMaxSize().padding(padding)) {
                    ViewModeBar(viewModel.camera.mode, onSelect = viewModel::setViewMode)
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        ModelViewport(mesh, viewModel)
                        WarningsBadge(plan.warnings)
                    }
                    CostPanel(
                        estimate = state.estimate,
                        plan = plan,
                        refreshing = state.refreshingPrices,
                        onRefresh = viewModel::refreshPrices,
                    )
                }
            }
        }
    }
}

@Composable
private fun ViewModeBar(current: ViewMode, onSelect: (ViewMode) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ViewMode.entries.forEach { mode ->
            FilterChip(
                selected = current == mode,
                onClick = { onSelect(mode) },
                label = { Text(mode.label) },
            )
        }
    }
}

/** The GL viewport with projected dimension/elevation labels and a 2D mini-map. */
@Composable
private fun ModelViewport(mesh: PlanMesh, viewModel: ViewerViewModel) {
    val renderer = remember { PlanRenderer() }
    var viewportSize by remember { mutableStateOf(IntSize(1, 1)) }
    var showMiniMap by remember { mutableStateOf(true) }
    val camera = viewModel.camera

    Box(Modifier.fillMaxSize().onSizeChanged { viewportSize = it }) {
        AndroidView(
            factory = { context ->
                PlanGLSurfaceView(context, renderer, mesh.radius) { transform ->
                    viewModel.updateCamera(transform)
                }
            },
            update = { view ->
                view.setModelRadius(mesh.radius)
                view.renderer.setMesh(mesh)
                view.renderer.cameraRef.set(camera)
                view.requestRender()
            },
            modifier = Modifier.fillMaxSize(),
        )

        LabelOverlay(mesh, camera, viewportSize)

        IconButton(
            onClick = { showMiniMap = !showMiniMap },
            modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
        ) {
            Icon(Icons.Default.Map, contentDescription = "Toggle 2D plan overlay")
        }
        if (showMiniMap && camera.mode != ViewMode.PLAN) {
            val plan = viewModel.state.collectAsState().value.plan?.plan
            if (plan != null) {
                PlanMiniMap(
                    plan,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(12.dp)
                        .size(140.dp),
                )
            }
        }
    }
}

/** Projects mesh label anchors through the same camera the GL thread uses. */
@Composable
private fun LabelOverlay(mesh: PlanMesh, camera: CameraState, viewportSize: IntSize) {
    if (viewportSize.width <= 1) return
    val aspect = viewportSize.width.toFloat() / viewportSize.height
    val vp = camera.viewProjection(aspect)
    val density = LocalDensity.current

    // Show the longest walls' dimensions to avoid clutter; elevations always shown.
    val labels = remember(mesh) {
        val dims = mesh.labels.filter { !it.isElevation }
            .sortedByDescending { it.text.removeSuffix(" m").toFloatOrNull() ?: 0f }
            .take(MAX_DIMENSION_LABELS)
        dims + mesh.labels.filter { it.isElevation }
    }

    labels.forEach { label ->
        val ndc = Mat4.project(vp, label.x, label.y, label.z) ?: return@forEach
        if (ndc[0] < -1.1f || ndc[0] > 1.1f || ndc[1] < -1.1f || ndc[1] > 1.1f) return@forEach
        val xPx = (ndc[0] + 1f) / 2f * viewportSize.width
        val yPx = (1f - ndc[1]) / 2f * viewportSize.height
        val xDp = with(density) { xPx.toDp() }
        val yDp = with(density) { yPx.toDp() }

        Surface(
            modifier = Modifier.offset(x = xDp - 24.dp, y = yDp - 10.dp),
            shape = RoundedCornerShape(4.dp),
            color = if (label.isElevation)
                MaterialTheme.colorScheme.secondary.copy(alpha = 0.85f)
            else
                MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
        ) {
            Text(
                label.text,
                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimary,
                maxLines = 1,
            )
        }
    }
}

/** Top-down 2D wall drawing shown alongside the 3D view. */
@Composable
fun PlanMiniMap(plan: FloorPlan, modifier: Modifier = Modifier) {
    val wallColor = MaterialTheme.colorScheme.onSurface
    Surface(modifier = modifier, shape = RoundedCornerShape(8.dp), tonalElevation = 3.dp) {
        Canvas(Modifier.fillMaxSize().padding(8.dp)) {
            val extentX = plan.widthMm.toFloat().coerceAtLeast(1f)
            val extentY = plan.depthMm.toFloat().coerceAtLeast(1f)
            val scale = minOf(size.width / extentX, size.height / extentY)
            val ox = (size.width - extentX * scale) / 2f
            val oy = (size.height - extentY * scale) / 2f
            plan.walls.forEach { wall ->
                drawLine(
                    color = wallColor,
                    start = Offset(ox + wall.startXMm.toFloat() * scale, oy + wall.startYMm.toFloat() * scale),
                    end = Offset(ox + wall.endXMm.toFloat() * scale, oy + wall.endYMm.toFloat() * scale),
                    strokeWidth = (wall.thicknessMm.toFloat() * scale).coerceIn(1.5f, 8f),
                    cap = StrokeCap.Butt,
                )
            }
        }
    }
}

@Composable
private fun WarningsBadge(warnings: List<String>) {
    if (warnings.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.padding(8.dp)) {
        Surface(
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.tertiaryContainer,
            onClick = { expanded = !expanded },
        ) {
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Warning, contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    if (expanded) "Extraction notes" else "${warnings.size} note(s)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
        }
        if (expanded) {
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
                modifier = Modifier.padding(top = 4.dp).width(280.dp),
            ) {
                Column(Modifier.padding(8.dp)) {
                    warnings.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

@Composable
private fun CostPanel(
    estimate: CostEstimate?,
    plan: FloorPlan,
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Surface(tonalElevation = 4.dp) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Estimated material cost", style = MaterialTheme.typography.labelMedium)
                    Text(
                        estimate?.let { "${it.currencySymbol}${"%,.0f".format(it.grandTotal)}" } ?: "Calculating…",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                if (refreshing) {
                    CircularProgressIndicator(Modifier.size(22.dp))
                } else {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh market prices")
                    }
                }
                IconButton(onClick = { expanded = !expanded }) {
                    Icon(
                        if (expanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                        contentDescription = if (expanded) "Collapse breakdown" else "Show cost breakdown",
                    )
                }
            }

            if (expanded && estimate != null) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .height(260.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    HorizontalDivider()
                    estimate.lines.forEach { line ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(line.material.displayName, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    "%,.1f %s × %s%,.2f".format(
                                        line.quantity, line.unit, estimate.currencySymbol, line.unitPrice),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Text(
                                "${estimate.currencySymbol}${"%,.0f".format(line.total)}",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                    HorizontalDivider()
                    Spacer(Modifier.height(6.dp))
                    if (estimate.pricesAsOfMillis > 0) {
                        Text(
                            "Prices as of ${DateFormat.getDateTimeInstance().format(Date(estimate.pricesAsOfMillis))}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    Text(
                        "Materials: ${plan.materials.joinToString { it.displayName }}",
                        style = MaterialTheme.typography.labelSmall,
                    )
                    estimate.assumptions.forEach {
                        Text("• $it", style = MaterialTheme.typography.labelSmall)
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

private const val MAX_DIMENSION_LABELS = 10
