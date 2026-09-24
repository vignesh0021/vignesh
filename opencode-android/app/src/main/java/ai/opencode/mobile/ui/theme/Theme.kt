package ai.opencode.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

private val DarkColors = darkColorScheme(
    primary = Teal,
    onPrimary = Ink,
    primaryContainer = PrimaryContainerDark,
    onPrimaryContainer = OnPrimaryContainerDark,
    secondary = Teal,
    onSecondary = Ink,
    secondaryContainer = SurfaceVariant,
    onSecondaryContainer = OnInk,
    background = Ink,
    onBackground = OnInk,
    surface = Surface,
    onSurface = OnInk,
    surfaceVariant = SurfaceVariant,
    onSurfaceVariant = Muted,
    surfaceContainer = SurfaceContainer,
    surfaceContainerHigh = SurfaceVariant,
    outline = Outline,
    outlineVariant = SurfaceVariant,
    error = Danger,
    onError = Ink,
    errorContainer = ErrorContainerDark,
    onErrorContainer = OnErrorContainerDark,
    tertiary = Amber,
)

private val LightColors = lightColorScheme(
    primary = TealDark,
    onPrimary = LightSurface,
    primaryContainer = PrimaryContainerLight,
    onPrimaryContainer = OnPrimaryContainerLight,
    secondary = TealDark,
    onSecondary = LightSurface,
    secondaryContainer = LightSurfaceVariant,
    onSecondaryContainer = LightOn,
    background = LightBg,
    onBackground = LightOn,
    surface = LightSurface,
    onSurface = LightOn,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightMuted,
    surfaceContainer = LightSurfaceContainer,
    surfaceContainerHigh = LightSurfaceVariant,
    outline = LightOutline,
    outlineVariant = LightSurfaceVariant,
    error = Danger,
    onError = LightSurface,
    errorContainer = ErrorContainerLight,
    onErrorContainer = OnErrorContainerLight,
    tertiary = Amber,
)

/** Monospace text style shared by code blocks and the file viewer. */
val MonoTextStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp)

@Composable
fun OpenCodeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
