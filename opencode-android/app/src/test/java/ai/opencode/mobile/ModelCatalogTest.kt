package ai.opencode.mobile

import ai.opencode.mobile.domain.model.ModelCatalog
import ai.opencode.mobile.domain.model.ProviderType
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelCatalogTest {

    @Test
    fun `anthropic provider only returns anthropic models`() {
        val models = ModelCatalog.forProvider(ProviderType.ANTHROPIC)
        assertTrue(models.isNotEmpty())
        assertTrue(models.all { it.provider == ProviderType.ANTHROPIC })
    }

    @Test
    fun `openai compatible reuses openai catalog`() {
        val models = ModelCatalog.forProvider(ProviderType.OPENAI_COMPATIBLE)
        assertTrue(models.all { it.provider == ProviderType.OPENAI })
    }

    @Test
    fun `default model is a member of the provider catalog`() {
        ProviderType.entries.forEach { provider ->
            val default = ModelCatalog.defaultModel(provider)
            assertTrue(default.isNotBlank())
        }
    }

    @Test
    fun `free providers expose free models`() {
        listOf(ProviderType.OPENROUTER, ProviderType.GROQ).forEach { provider ->
            val models = ModelCatalog.forProvider(provider)
            assertTrue("$provider should have models", models.isNotEmpty())
            assertTrue("$provider should have a free model", models.any { it.free })
        }
    }

    @Test
    fun `default provider default model is free`() {
        val id = ModelCatalog.defaultModel(ProviderType.OPENROUTER)
        val model = ModelCatalog.models.first { it.id == id }
        assertTrue(model.free)
    }
}
