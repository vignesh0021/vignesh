package com.floorplan3d.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Delete
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/** A processed plan, cached locally: source image path + extraction result as JSON. */
@Entity(tableName = "plans")
data class PlanEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val createdAtMillis: Long,
    val sourceImagePath: String,
    val floorPlanJson: String,
)

/** A material unit price, seeded from the built-in catalog and refreshable remotely. */
@Entity(tableName = "material_prices")
data class MaterialPriceEntity(
    @PrimaryKey val material: String,
    val pricePerUnit: Double,
    val unit: String,
    val updatedAtMillis: Long,
    val source: String,
)

@Dao
interface PlanDao {
    @Query("SELECT * FROM plans ORDER BY createdAtMillis DESC")
    fun observeAll(): Flow<List<PlanEntity>>

    @Query("SELECT * FROM plans WHERE id = :id")
    suspend fun findById(id: Long): PlanEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(plan: PlanEntity): Long

    @Delete
    suspend fun delete(plan: PlanEntity)
}

@Dao
interface MaterialPriceDao {
    @Query("SELECT * FROM material_prices")
    suspend fun getAll(): List<MaterialPriceEntity>

    @Query("SELECT * FROM material_prices")
    fun observeAll(): Flow<List<MaterialPriceEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(prices: List<MaterialPriceEntity>)
}

@Database(
    entities = [PlanEntity::class, MaterialPriceEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class PlanDatabase : RoomDatabase() {
    abstract fun planDao(): PlanDao
    abstract fun materialPriceDao(): MaterialPriceDao

    companion object {
        fun build(context: Context): PlanDatabase =
            Room.databaseBuilder(context, PlanDatabase::class.java, "floorplan3d.db")
                .fallbackToDestructiveMigration()
                .build()
    }
}
