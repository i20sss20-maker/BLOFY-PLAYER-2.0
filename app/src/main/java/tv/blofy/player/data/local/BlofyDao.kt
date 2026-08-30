package tv.blofy.player.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface BlofyDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProvider(provider: ProviderEntity)

    @Query("SELECT * FROM providers WHERE enabled = 1 ORDER BY updatedAt DESC")
    fun providers(): Flow<List<ProviderEntity>>

    @Query("SELECT * FROM providers ORDER BY updatedAt DESC")
    fun allProviders(): Flow<List<ProviderEntity>>

    @Query("SELECT * FROM providers WHERE id = :providerId LIMIT 1")
    suspend fun provider(providerId: String): ProviderEntity?

    @Query("UPDATE providers SET enabled = 0")
    suspend fun disableAllProviders()

    @Query("UPDATE providers SET enabled = 1, updatedAt = :updatedAt WHERE id = :providerId")
    suspend fun activateProvider(providerId: String, updatedAt: Long = System.currentTimeMillis())

    @Query("DELETE FROM providers WHERE id = :providerId")
    suspend fun deleteProvider(providerId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCategories(items: List<CategoryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertStreams(items: List<StreamEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEpisodes(items: List<EpisodeEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEpg(items: List<EpgEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertActivation(state: ActivationEntity)

    @Query("SELECT * FROM activation LIMIT 1")
    suspend fun activation(): ActivationEntity?

    @Query("SELECT * FROM categories WHERE providerId = :providerId AND kind = :kind AND hidden = 0 ORDER BY orderIndex, name")
    fun categories(providerId: String, kind: String): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (:categoryId IS NULL OR categoryId = :categoryId) ORDER BY name")
    fun streams(providerId: String, kind: String, categoryId: String?): Flow<List<StreamEntity>>

    @Query("SELECT * FROM streams WHERE key = :contentKey LIMIT 1")
    suspend fun stream(contentKey: String): StreamEntity?

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND favorite = 1 ORDER BY name")
    fun favorites(providerId: String): Flow<List<StreamEntity>>

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND name LIKE '%' || :query || '%' ORDER BY name LIMIT :limit")
    suspend fun searchStreams(providerId: String, query: String, limit: Int = 80): List<StreamEntity>

    @Query("UPDATE streams SET favorite = :favorite WHERE key = :contentKey")
    suspend fun setFavorite(contentKey: String, favorite: Boolean)

    @Query("UPDATE streams SET locked = :locked WHERE key = :contentKey")
    suspend fun setLocked(contentKey: String, locked: Boolean)

    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId ORDER BY season, episode")
    fun episodes(providerId: String, seriesId: String): Flow<List<EpisodeEntity>>

    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND endMs >= :nowMs ORDER BY startMs LIMIT :limit")
    fun epg(providerId: String, streamId: String, nowMs: Long, limit: Int = 20): Flow<List<EpgEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveWatchState(state: WatchStateEntity)

    @Query("SELECT * FROM watch_state WHERE contentKey = :contentKey LIMIT 1")
    suspend fun watchState(contentKey: String): WatchStateEntity?

    @Query("SELECT * FROM watch_state WHERE providerId = :providerId AND completed = 0 AND positionMs > 0 ORDER BY updatedAt DESC LIMIT :limit")
    fun continueWatching(providerId: String, limit: Int = 30): Flow<List<WatchStateEntity>>

    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind = :kind")
    suspend fun clearCategories(providerId: String, kind: String)

    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind = :kind")
    suspend fun clearStreams(providerId: String, kind: String)

    @Query("DELETE FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId")
    suspend fun clearEpisodes(providerId: String, seriesId: String)

    @Query("DELETE FROM epg WHERE providerId = :providerId AND streamId = :streamId")
    suspend fun clearEpg(providerId: String, streamId: String)
}
