package ai.opencode.mobile

import ai.opencode.mobile.data.local.toDomain
import ai.opencode.mobile.data.local.toEntity
import ai.opencode.mobile.domain.model.ChatMessage
import ai.opencode.mobile.domain.model.MessageStatus
import ai.opencode.mobile.domain.model.ProviderType
import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.domain.model.Session
import org.junit.Assert.assertEquals
import org.junit.Test

class MappersTest {

    @Test
    fun `session round trips through entity`() {
        val session = Session(
            id = "s1",
            title = "Test",
            provider = ProviderType.OPENAI,
            modelId = "gpt-4o",
            projectPath = "/tmp/x",
        )
        val back = session.toEntity().toDomain()
        assertEquals(session.id, back.id)
        assertEquals(session.provider, back.provider)
        assertEquals(session.modelId, back.modelId)
        assertEquals(session.projectPath, back.projectPath)
    }

    @Test
    fun `message round trips through entity`() {
        val message = ChatMessage(
            id = "m1",
            sessionId = "s1",
            role = Role.ASSISTANT,
            content = "hi",
            status = MessageStatus.STREAMING,
            model = "claude-opus-4-8",
        )
        val back = message.toEntity().toDomain()
        assertEquals(message.role, back.role)
        assertEquals(message.status, back.status)
        assertEquals(message.content, back.content)
    }

    @Test
    fun `unknown provider name falls back to the default free provider`() {
        assertEquals(ProviderType.OPENROUTER, ProviderType.fromName("does-not-exist"))
    }
}
