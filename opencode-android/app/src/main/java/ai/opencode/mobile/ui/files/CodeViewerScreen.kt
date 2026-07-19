package ai.opencode.mobile.ui.files

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ai.opencode.mobile.ui.theme.MonoTextStyle
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodeViewerScreen(
    path: String,
    onBack: () -> Unit,
    viewModel: CodeViewerViewModel = viewModel(factory = CodeViewerViewModel.provideFactory(path)),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.messages.collect { snackbar.showSnackbar(it) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(File(path).name, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::toggleEdit) {
                        Icon(
                            if (state.editing) Icons.Filled.Visibility else Icons.Filled.Edit,
                            contentDescription = if (state.editing) "Preview" else "Edit",
                        )
                    }
                    if (state.editing) {
                        IconButton(onClick = viewModel::save) {
                            Icon(Icons.Filled.Save, contentDescription = "Save")
                        }
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> CircularProgressIndicator(Modifier.padding(padding).padding(24.dp))
            state.editing -> BasicTextField(
                value = state.content,
                onValueChange = viewModel::onContentChange,
                textStyle = MonoTextStyle.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(12.dp)
                    .verticalScroll(rememberScrollState()),
            )
            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(12.dp)
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
            ) {
                Text(text = highlightViewer(state.content), style = MonoTextStyle)
            }
        }
    }
}
