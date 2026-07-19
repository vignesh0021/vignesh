package ai.opencode.mobile.ui.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import ai.opencode.mobile.ui.chat.ChatScreen
import ai.opencode.mobile.ui.files.CodeViewerScreen
import ai.opencode.mobile.ui.files.FilesScreen
import ai.opencode.mobile.ui.sessions.SessionsScreen
import ai.opencode.mobile.ui.settings.SettingsScreen

object Routes {
    const val SESSIONS = "sessions"
    const val CHAT = "chat/{sessionId}"
    const val FILES = "files"
    const val VIEWER = "viewer/{path}"
    const val SETTINGS = "settings"

    fun chat(sessionId: String) = "chat/$sessionId"
    fun viewer(path: String) = "viewer/${Uri.encode(path)}"
}

@Composable
fun AppNavHost(navController: NavHostController = rememberNavController()) {
    NavHost(navController = navController, startDestination = Routes.SESSIONS) {
        composable(Routes.SESSIONS) {
            SessionsScreen(
                onOpenSession = { navController.navigate(Routes.chat(it)) },
                onOpenFiles = { navController.navigate(Routes.FILES) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(
            route = Routes.CHAT,
            arguments = listOf(navArgument("sessionId") { type = NavType.StringType }),
        ) { entry ->
            val sessionId = entry.arguments?.getString("sessionId").orEmpty()
            ChatScreen(
                sessionId = sessionId,
                onBack = { navController.popBackStack() },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.FILES) {
            FilesScreen(
                onBack = { navController.popBackStack() },
                onOpenFile = { navController.navigate(Routes.viewer(it)) },
            )
        }
        composable(
            route = Routes.VIEWER,
            arguments = listOf(navArgument("path") { type = NavType.StringType }),
        ) { entry ->
            val path = entry.arguments?.getString("path").orEmpty()
            CodeViewerScreen(path = path, onBack = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
