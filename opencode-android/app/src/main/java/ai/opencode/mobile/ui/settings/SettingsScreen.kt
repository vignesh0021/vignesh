package ai.opencode.mobile.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ai.opencode.mobile.domain.model.PromptPresets
import ai.opencode.mobile.domain.model.ProviderType
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = viewModel(factory = SettingsViewModel.Factory),
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val keyStatus by viewModel.keyStatus.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var apiKeyInput by remember { mutableStateOf("") }
    var baseUrlInput by remember(settings.baseUrl) { mutableStateOf(settings.baseUrl) }
    var promptInput by remember(settings.systemPrompt) { mutableStateOf(settings.systemPrompt) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
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
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SectionCard(title = "Provider") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProviderType.entries.forEach { provider ->
                        FilterChip(
                            selected = settings.provider == provider,
                            onClick = { viewModel.setProvider(provider) },
                            label = { Text(provider.displayName) },
                        )
                    }
                }
            }

            SectionCard(title = "Model") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    viewModel.modelsFor(settings.provider).forEach { model ->
                        FilterChip(
                            selected = settings.modelId == model.id,
                            onClick = { viewModel.setModel(model.id) },
                            label = { Text(model.label) },
                        )
                    }
                }
            }

            SectionCard(title = "API key · ${settings.provider.displayName}") {
                val hasKey = keyStatus[settings.provider] == true
                Text(
                    text = if (hasKey) "A key is saved (encrypted on-device)." else "No key saved yet.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                settings.provider.keyUrl?.let { url ->
                    Text(
                        text = "Get a free key: $url",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                OutlinedTextField(
                    value = apiKeyInput,
                    onValueChange = { apiKeyInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Paste API key") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                androidx.compose.foundation.layout.Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            if (apiKeyInput.isNotBlank()) {
                                viewModel.saveApiKey(settings.provider, apiKeyInput)
                                apiKeyInput = ""
                                scope.launch { snackbar.showSnackbar("API key saved") }
                            }
                        },
                    ) { Text("Save key") }
                    OutlinedButton(
                        onClick = {
                            viewModel.clearApiKey(settings.provider)
                            scope.launch { snackbar.showSnackbar("API key cleared") }
                        },
                    ) { Text("Clear") }
                }
            }

            SectionCard(title = "Base URL") {
                OutlinedTextField(
                    value = baseUrlInput,
                    onValueChange = { baseUrlInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("Endpoint base URL") },
                )
                OutlinedButton(onClick = {
                    viewModel.setBaseUrl(baseUrlInput)
                    scope.launch { snackbar.showSnackbar("Base URL updated") }
                }) { Text("Save URL") }
            }

            SectionCard(title = "Prompt presets") {
                Text(
                    "Adapted from open-source coding-agent prompts.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PromptPresets.all.forEach { preset ->
                        FilterChip(
                            selected = settings.systemPrompt == preset.prompt,
                            onClick = { viewModel.setSystemPrompt(preset.prompt) },
                            label = { Text(preset.label) },
                        )
                    }
                }
            }

            SectionCard(title = "System prompt") {
                OutlinedTextField(
                    value = promptInput,
                    onValueChange = { promptInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Instructions sent with every message") },
                    minLines = 3,
                )
                OutlinedButton(onClick = {
                    viewModel.setSystemPrompt(promptInput)
                    scope.launch { snackbar.showSnackbar("System prompt saved") }
                }) { Text("Save prompt") }
            }

            Text(
                "OpenCode Mobile mirrors opencode.ai's pluggable-provider workflow. Keys are " +
                    "stored with AES-256 via the Android Keystore and never leave your device " +
                    "except in requests to the provider you choose.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
