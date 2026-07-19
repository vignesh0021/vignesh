package ai.opencode.mobile.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions WHERE id = :id")
    suspend fun findById(id: String): SessionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(session: SessionEntity)

    @Query("UPDATE sessions SET updatedAt = :timestamp WHERE id = :id")
    suspend fun touch(id: String, timestamp: Long)

    @Query("UPDATE sessions SET title = :title, updatedAt = :timestamp WHERE id = :id")
    suspend fun rename(id: String, title: String, timestamp: Long)

    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE sessionId = :sessionId ORDER BY createdAt ASC")
    fun observeForSession(sessionId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE sessionId = :sessionId ORDER BY createdAt ASC")
    suspend fun listForSession(sessionId: String): List<MessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(message: MessageEntity)

    @Update
    suspend fun update(message: MessageEntity)

    @Query("UPDATE messages SET content = :content, status = :status WHERE id = :id")
    suspend fun updateContent(id: String, content: String, status: String)

    @Query("DELETE FROM messages WHERE id = :id")
    suspend fun delete(id: String)
}
