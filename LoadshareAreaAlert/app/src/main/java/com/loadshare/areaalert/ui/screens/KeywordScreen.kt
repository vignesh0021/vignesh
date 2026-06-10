package com.loadshare.areaalert.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.loadshare.areaalert.model.Keyword
import com.loadshare.areaalert.ui.theme.SuccessGreen
import com.loadshare.areaalert.viewmodel.KeywordViewModel

private val BlockedRed = Color(0xFFE53935)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KeywordScreen(
    onNavigateBack: () -> Unit,
    viewModel: KeywordViewModel = hiltViewModel()
) {
    val keywords by viewModel.keywords.collectAsState()
    var newKeywordText by remember { mutableStateOf("") }
    var addAsExclude by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf<Keyword?>(null) }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    val includeList = keywords.filter { !it.isExclude }
    val excludeList = keywords.filter { it.isExclude }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Location Keywords",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${includeList.count { it.isEnabled }} preferred · ${excludeList.count { it.isEnabled }} blocked",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // ── Add keyword section ──────────────────────────────────────
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                shape = RoundedCornerShape(16.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Add Location",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )

                    // Include / Block toggle
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !addAsExclude,
                            onClick = { addAsExclude = false },
                            label = { Text("Preferred Area") },
                            leadingIcon = {
                                Icon(Icons.Default.CheckCircle, null,
                                    modifier = Modifier.size(16.dp))
                            },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = SuccessGreen.copy(alpha = 0.15f),
                                selectedLabelColor = SuccessGreen,
                                selectedLeadingIconColor = SuccessGreen
                            )
                        )
                        FilterChip(
                            selected = addAsExclude,
                            onClick = { addAsExclude = true },
                            label = { Text("Blocked Area") },
                            leadingIcon = {
                                Icon(Icons.Default.Block, null,
                                    modifier = Modifier.size(16.dp))
                            },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = BlockedRed.copy(alpha = 0.12f),
                                selectedLabelColor = BlockedRed,
                                selectedLeadingIconColor = BlockedRed
                            )
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = newKeywordText,
                            onValueChange = { newKeywordText = it },
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(focusRequester),
                            placeholder = {
                                Text(if (addAsExclude) "e.g. Karapakkam" else "e.g. ECR")
                            },
                            leadingIcon = {
                                Icon(
                                    if (addAsExclude) Icons.Default.Block else Icons.Default.LocationOn,
                                    contentDescription = null,
                                    tint = if (addAsExclude) BlockedRed else MaterialTheme.colorScheme.primary
                                )
                            },
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Words,
                                imeAction = ImeAction.Done
                            ),
                            keyboardActions = KeyboardActions(onDone = {
                                if (newKeywordText.isNotBlank()) {
                                    viewModel.addKeyword(newKeywordText, addAsExclude)
                                    newKeywordText = ""
                                    focusManager.clearFocus()
                                }
                            }),
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp)
                        )
                        Button(
                            onClick = {
                                if (newKeywordText.isNotBlank()) {
                                    viewModel.addKeyword(newKeywordText, addAsExclude)
                                    newKeywordText = ""
                                    focusManager.clearFocus()
                                }
                            },
                            enabled = newKeywordText.isNotBlank(),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (addAsExclude) BlockedRed
                                                else MaterialTheme.colorScheme.primary
                            ),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Add")
                        }
                    }

                    if (addAsExclude) {
                        Text(
                            text = "Orders with this area name will be skipped and auto-dismissed — even if a preferred keyword also appears.",
                            style = MaterialTheme.typography.bodySmall,
                            color = BlockedRed.copy(alpha = 0.8f)
                        )
                    }
                }
            }

            if (keywords.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Default.LocationOff,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                        )
                        Text(
                            text = "No keywords added",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().weight(1f),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (includeList.isNotEmpty()) {
                        item {
                            SectionHeader(
                                text = "Preferred Areas",
                                color = SuccessGreen
                            )
                        }
                        items(includeList, key = { it.id }) { keyword ->
                            AnimatedVisibility(
                                visible = true,
                                enter = slideInVertically() + fadeIn(),
                                exit = slideOutVertically() + fadeOut()
                            ) {
                                KeywordItem(
                                    keyword = keyword,
                                    onToggle = { viewModel.toggleKeyword(keyword.id) },
                                    onFlipType = { viewModel.toggleKeywordExclude(keyword.id) },
                                    onDelete = { showDeleteDialog = keyword }
                                )
                            }
                        }
                    }

                    if (excludeList.isNotEmpty()) {
                        item {
                            SectionHeader(
                                text = "Blocked Areas",
                                color = BlockedRed,
                                modifier = Modifier.padding(top = if (includeList.isNotEmpty()) 8.dp else 0.dp)
                            )
                        }
                        items(excludeList, key = { it.id }) { keyword ->
                            AnimatedVisibility(
                                visible = true,
                                enter = slideInVertically() + fadeIn(),
                                exit = slideOutVertically() + fadeOut()
                            ) {
                                KeywordItem(
                                    keyword = keyword,
                                    onToggle = { viewModel.toggleKeyword(keyword.id) },
                                    onFlipType = { viewModel.toggleKeywordExclude(keyword.id) },
                                    onDelete = { showDeleteDialog = keyword }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    showDeleteDialog?.let { keyword ->
        AlertDialog(
            onDismissRequest = { showDeleteDialog = null },
            title = { Text("Remove Keyword") },
            text = { Text("Remove \"${keyword.text}\" from your keywords?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.removeKeyword(keyword.id)
                        showDeleteDialog = null
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun SectionHeader(
    text: String,
    color: Color,
    modifier: Modifier = Modifier
) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = modifier.padding(vertical = 4.dp)
    )
}

@Composable
private fun KeywordItem(
    keyword: Keyword,
    onToggle: () -> Unit,
    onFlipType: () -> Unit,
    onDelete: () -> Unit
) {
    val accentColor = if (keyword.isExclude) BlockedRed else SuccessGreen
    val borderColor = if (keyword.isExclude) BlockedRed.copy(alpha = 0.3f) else Color.Transparent

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, borderColor, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (keyword.isEnabled)
                MaterialTheme.colorScheme.surface
            else
                MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    if (keyword.isExclude) Icons.Default.Block else Icons.Default.LocationOn,
                    contentDescription = null,
                    tint = if (keyword.isEnabled) accentColor else accentColor.copy(alpha = 0.35f),
                    modifier = Modifier.size(20.dp)
                )
                Column {
                    Text(
                        text = keyword.text,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (keyword.isEnabled) FontWeight.Medium else FontWeight.Normal,
                        color = if (keyword.isEnabled)
                            MaterialTheme.colorScheme.onSurface
                        else
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                    Text(
                        text = when {
                            !keyword.isEnabled -> "Disabled"
                            keyword.isExclude -> "Blocked — orders auto-dismissed"
                            else -> "Active — alerts enabled"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (keyword.isEnabled) accentColor else accentColor.copy(alpha = 0.4f)
                    )
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(0.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Flip between preferred/blocked
                IconButton(onClick = onFlipType, modifier = Modifier.size(36.dp)) {
                    Icon(
                        if (keyword.isExclude) Icons.Default.CheckCircle else Icons.Default.Block,
                        contentDescription = if (keyword.isExclude) "Move to preferred" else "Move to blocked",
                        tint = if (keyword.isExclude) SuccessGreen.copy(alpha = 0.7f) else BlockedRed.copy(alpha = 0.6f),
                        modifier = Modifier.size(18.dp)
                    )
                }
                Switch(
                    checked = keyword.isEnabled,
                    onCheckedChange = { onToggle() },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = accentColor,
                        checkedTrackColor = accentColor.copy(alpha = 0.3f)
                    )
                )
                IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Delete",
                        tint = MaterialTheme.colorScheme.error.copy(alpha = 0.7f),
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}
