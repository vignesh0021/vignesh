package ai.opencode.mobile

import ai.opencode.mobile.domain.model.PromptPresets
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptPresetsTest {

    @Test
    fun `presets are non-empty and have unique ids`() {
        assertTrue(PromptPresets.all.isNotEmpty())
        val ids = PromptPresets.all.map { it.id }
        assertTrue("ids must be unique", ids.size == ids.toSet().size)
        assertTrue(PromptPresets.all.all { it.prompt.isNotBlank() && it.label.isNotBlank() })
    }

    @Test
    fun `default preset is part of the list`() {
        assertTrue(PromptPresets.DEFAULT in PromptPresets.all)
    }
}
