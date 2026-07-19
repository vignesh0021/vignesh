package ai.opencode.mobile.data.local

import ai.opencode.mobile.domain.model.ChatMessage
import ai.opencode.mobile.domain.model.MessageStatus
import ai.opencode.mobile.domain.model.ProviderType
import ai.opencode.mobile.domain.model.Role
import ai.opencode.mobile.domain.model.Session

fun SessionEntity.toDomain(): Session = Session(
    id = id,
    title = title,
    provider = ProviderType.fromName(provider),
    modelId = modelId,
    projectPath = projectPath,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun Session.toEntity(): SessionEntity = SessionEntity(
    id = id,
    title = title,
    provider = provider.name,
    modelId = modelId,
    projectPath = projectPath,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun MessageEntity.toDomain(): ChatMessage = ChatMessage(
    id = id,
    sessionId = sessionId,
    role = runCatching { Role.valueOf(role) }.getOrDefault(Role.ASSISTANT),
    content = content,
    status = runCatching { MessageStatus.valueOf(status) }.getOrDefault(MessageStatus.COMPLETE),
    model = model,
    createdAt = createdAt,
)

fun ChatMessage.toEntity(): MessageEntity = MessageEntity(
    id = id,
    sessionId = sessionId,
    role = role.name,
    content = content,
    status = status.name,
    model = model,
    createdAt = createdAt,
)
