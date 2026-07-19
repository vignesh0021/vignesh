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
    secondary = TealDark,
    background = Ink,
    onBackground = OnInk,
    surface = Surface,
    onSurface = OnInk,
    surfaceVariant = SurfaceVariant,
    onSurfaceVariant = Muted,
    error = Danger,
    tertiary = Amber,
)

private val LightColors = lightColorScheme(
    primary = TealDark,
    onPrimary = LightSurface,
    secondary = Teal,
    background = LightBg,
    onBackground = LightOn,
    surface = LightSurface,
    onSurface = LightOn,
    error = Danger,
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
