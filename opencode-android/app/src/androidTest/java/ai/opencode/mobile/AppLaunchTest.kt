package ai.opencode.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Minimal instrumentation smoke test. Kept intentionally light so it can run on any
 * emulator profile in CI without flakiness.
 */
@RunWith(AndroidJUnit4::class)
class AppLaunchTest {

    @Test
    fun applicationPackageIsCorrect() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // debug build applies the .debug suffix
        assertEquals("ai.opencode.mobile.debug", context.packageName)
    }
}
