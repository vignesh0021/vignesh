package ai.opencode.mobile.ui.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
import ai.opencode.mobile.data.repository.FileNode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(
    onBack: () -> Unit,
    onOpenFile: (String) -> Unit,
    viewModel: FilesViewModel = viewModel(factory = FilesViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<CreateDialog?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Project files", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { dialog = CreateDialog.NewFile }) {
                        Icon(Icons.Filled.NoteAdd, contentDescription = "New file")
                    }
                    IconButton(onClick = { dialog = CreateDialog.NewFolder }) {
                        Icon(Icons.Filled.CreateNewFolder, contentDescription = "New folder")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            PathBar(path = state.currentPath, canGoUp = state.canGoUp, onUp = viewModel::goUp)
            HorizontalDivider()
            if (state.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(state.nodes, key = { it.absolutePath }) { node ->
                        FileRow(
                            node = node,
                            onClick = {
                                if (node.isDirectory) viewModel.open(node.absolutePath)
                                else onOpenFile(node.absolutePath)
                            },
                            onDelete = { viewModel.delete(node.absolutePath) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    dialog?.let { which ->
        NameDialog(
            title = if (which == CreateDialog.NewFile) "New file" else "New folder",
            onConfirm = { name ->
                if (which == CreateDialog.NewFile) viewModel.createFile(name)
                else viewModel.createDir(name)
                dialog = null
            },
            onDismiss = { dialog = null },
        )
    }
}

private enum class CreateDialog { NewFile, NewFolder }

@Composable
private fun PathBar(path: String, canGoUp: Boolean, onUp: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val display = path.substringAfterLast("/workspace", path).ifBlank { "/" }
        Text(
            text = "workspace$display",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (canGoUp) {
            TextButton(onClick = onUp) { Text("Up") }
        }
    }
}

@Composable
private fun FileRow(node: FileNode, onClick: () -> Unit, onDelete: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (node.isDirectory) Icons.Filled.Folder
            else Icons.Filled.Description,
            contentDescription = null,
            tint = if (node.isDirectory) MaterialTheme.colorScheme.tertiary
            else MaterialTheme.colorScheme.primary,
        )
        Column(
            Modifier
                .weight(1f)
                .padding(start = 12.dp)
        ) {
            Text(node.name, style = MaterialTheme.typography.bodyLarge)
            if (!node.isDirectory) {
                Text(
                    "${node.sizeBytes} bytes",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun NameDialog(title: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                singleLine = true,
                placeholder = { Text("name") },
            )
        },
        confirmButton = {
            TextButton(onClick = { if (name.isNotBlank()) onConfirm(name) }) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
