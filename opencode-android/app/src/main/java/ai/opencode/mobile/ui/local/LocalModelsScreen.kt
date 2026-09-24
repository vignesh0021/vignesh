@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package ai.opencode.mobile.ui.local

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ai.opencode.mobile.data.local.InstalledModel
import ai.opencode.mobile.data.local.LocalModelInfo

@Composable
fun LocalModelsScreen(
    onBack: () -> Unit,
    viewModel: LocalModelsViewModel = viewModel(factory = LocalModelsViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activePath by viewModel.activePath.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var token by remember { mutableStateOf("") }
    var urlInput by remember { mutableStateOf("") }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) viewModel.import(uri) }

    LaunchedEffect(state.status) {
        state.status?.let {
            snackbar.showSnackbar(it)
            viewModel.clearStatus()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("On-device models", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    androidx.compose.material3.IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            IntroCard()

            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("Hugging Face token (optional, for gated models)") },
            )

            Text("Suggested models", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            state.catalog.forEach { info ->
                CatalogCard(
                    info = info,
                    installedPath = state.installed.firstOrNull { it.name == info.fileName }?.path,
                    isActive = activePath != null && activePath == state.installed.firstOrNull { it.name == info.fileName }?.path,
                    isDownloading = state.downloadingId == info.id,
                    fraction = state.downloadFraction,
                    anyDownloadRunning = state.downloadingId != null,
                    onDownload = { viewModel.downloadCatalog(info, token) },
                    onUse = { path -> viewModel.use(path) },
                    onDelete = { path -> viewModel.delete(path) },
                )
            }

            Text("Download from URL", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            OutlinedTextField(
                value = urlInput,
                onValueChange = { urlInput = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("Direct .task model URL") },
                placeholder = { Text("https://huggingface.co/.../model.task") },
            )
            OutlinedButton(
                onClick = { viewModel.downloadUrl(urlInput, token) },
                enabled = urlInput.isNotBlank() && state.downloadingId == null,
            ) {
                Icon(Icons.Filled.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Download")
            }
            if (state.downloadingId?.startsWith("url:") == true) {
                LinearProgressIndicator(
                    progress = { state.downloadFraction },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Button(
                onClick = { importLauncher.launch(arrayOf("*/*")) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
            ) {
                if (state.busy) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.FolderOpen, contentDescription = null, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(6.dp))
                Text("Import a .task file from device")
            }

            val extras = state.installed.filter { inst -> state.catalog.none { it.fileName == inst.name } }
            if (extras.isNotEmpty()) {
                Text("Imported / other models", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                extras.forEach { model ->
                    InstalledCard(
                        model = model,
                        isActive = activePath == model.path,
                        onUse = { viewModel.use(model.path) },
                        onDelete = { viewModel.delete(model.path) },
                    )
                }
            }
        }
    }
}

@Composable
private fun IntroCard() {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("Run AI offline", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                "Download a compressed (quantized) model once, then chat with no internet and " +
                    "no API key. Models are large (0.5–1.5 GB) and run best on newer phones with " +
                    "plenty of free RAM. Gated Hugging Face models need a free access token.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun CatalogCard(
    info: LocalModelInfo,
    installedPath: String?,
    isActive: Boolean,
    isDownloading: Boolean,
    fraction: Float,
    anyDownloadRunning: Boolean,
    onDownload: () -> Unit,
    onUse: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(info.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (isActive) ActiveBadge()
            }
            Spacer(Modifier.height(4.dp))
            Text(info.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Text("~${info.approxSizeMb} MB", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))

            when {
                isDownloading -> {
                    LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(4.dp))
                    Text("Downloading… ${(fraction * 100).toInt()}%", style = MaterialTheme.typography.labelSmall)
                }
                installedPath != null -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onUse(installedPath) }, enabled = !isActive) {
                        Text(if (isActive) "In use" else "Use")
                    }
                    TextButton(onClick = { onDelete(installedPath) }) { Text("Delete") }
                }
                else -> OutlinedButton(onClick = onDownload, enabled = !anyDownloadRunning) {
                    Icon(Icons.Filled.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Download")
                }
            }
        }
    }
}

@Composable
private fun InstalledCard(
    model: InstalledModel,
    isActive: Boolean,
    onUse: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(model.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (isActive) ActiveBadge()
            }
            Spacer(Modifier.height(4.dp))
            Text("${model.sizeBytes / (1024 * 1024)} MB", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onUse, enabled = !isActive) { Text(if (isActive) "In use" else "Use") }
                TextButton(onClick = onDelete) { Text("Delete") }
            }
        }
    }
}

@Composable
private fun ActiveBadge() {
    Surface(
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            "Active",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}
