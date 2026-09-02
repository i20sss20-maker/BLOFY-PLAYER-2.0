package tv.blofy.player.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface BlofyDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertProvider(provider: ProviderEntity)
    @Query("SELECT * FROM providers WHERE enabled = 1 ORDER BY updatedAt DESC") fun providers(): Flow<List<ProviderEntity>>
    @Query("SELECT * FROM providers ORDER BY updatedAt DESC") fun allProviders(): Flow<List<ProviderEntity>>
    @Query("SELECT * FROM providers WHERE id = :providerId LIMIT 1") suspend fun provider(providerId: String): ProviderEntity?
    @Query("UPDATE providers SET enabled = 0") suspend fun disableAllProviders()
    @Query("UPDATE providers SET enabled = 1, updatedAt = :updatedAt WHERE id = :providerId") suspend fun activateProvider(providerId: String, updatedAt: Long = System.currentTimeMillis())
    @Query("DELETE FROM providers WHERE id = :providerId") suspend fun deleteProvider(providerId: String)

    @Transaction suspend fun saveAndActivateProvider(provider: ProviderEntity) { upsertProvider(provider.copy(enabled = true)); disableAllProviders(); activateProvider(provider.id, provider.updatedAt) }

    @Query("SELECT * FROM categories WHERE providerId = :providerId") suspend fun allCategoriesForProvider(providerId: String): List<CategoryEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId") suspend fun allStreamsForProvider(providerId: String): List<StreamEntity>
    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId") suspend fun streamCountForProvider(providerId: String): Int
    @Query("SELECT EXISTS(SELECT 1 FROM streams WHERE providerId = :providerId LIMIT 1)") suspend fun hasStreamsForProvider(providerId: String): Boolean
    suspend fun hasCatalog(providerId: String): Boolean = hasStreamsForProvider(providerId)
    @Query("SELECT * FROM episodes WHERE providerId = :providerId") suspend fun allEpisodesForProvider(providerId: String): List<EpisodeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertCategories(items: List<CategoryEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertStreams(items: List<StreamEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpisodes(items: List<EpisodeEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpg(items: List<EpgEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertActivation(state: ActivationEntity)
    @Query("SELECT * FROM activation LIMIT 1") suspend fun activation(): ActivationEntity?
    @Query("DELETE FROM activation") suspend fun clearActivation()
    @Transaction suspend fun replaceActivation(state: ActivationEntity) { clearActivation(); upsertActivation(state) }

    @Query("SELECT * FROM categories WHERE providerId = :providerId AND kind = :kind AND hidden = 0 ORDER BY orderIndex, name") fun categories(providerId: String, kind: String): Flow<List<CategoryEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind ORDER BY name") fun streamsAll(providerId: String, kind: String): Flow<List<StreamEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId ORDER BY name") fun streamsInCategory(providerId: String, kind: String, categoryId: String): Flow<List<StreamEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (:categoryId IS NULL OR categoryId = :categoryId) ORDER BY name") fun streams(providerId: String, kind: String, categoryId: String?): Flow<List<StreamEntity>>

    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun catalogCountAll(providerId: String, kind: String): Int
    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId") suspend fun catalogCountInCategory(providerId: String, kind: String, categoryId: String): Int

    // Legacy OFFSET queries remain available for compatibility, but large TV catalogs use keyset paging below.
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind ORDER BY rowid LIMIT :limit OFFSET :offset") suspend fun catalogPageAll(providerId: String, kind: String, limit: Int, offset: Int): List<StreamEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId ORDER BY rowid LIMIT :limit OFFSET :offset") suspend fun catalogPageInCategory(providerId: String, kind: String, categoryId: String, limit: Int, offset: Int): List<StreamEntity>

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND rowid > :afterRowId ORDER BY rowid LIMIT :limit")
    suspend fun catalogPageAfterAll(providerId: String, kind: String, afterRowId: Long, limit: Int): List<StreamEntity>

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId AND rowid > :afterRowId ORDER BY rowid LIMIT :limit")
    suspend fun catalogPageAfterInCategory(providerId: String, kind: String, categoryId: String, afterRowId: Long, limit: Int): List<StreamEntity>

    @Query("SELECT rowid FROM streams WHERE `key` = :contentKey LIMIT 1")
    suspend fun streamRowId(contentKey: String): Long?

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind IN ('movie','series') ORDER BY COALESCE(addedAt, 0) DESC, name LIMIT :limit") suspend fun latestHomeStreams(providerId: String, limit: Int = 14): List<StreamEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (name LIKE '%' || :query || '%' OR genre LIKE '%' || :query || '%' OR year LIKE '%' || :query || '%') ORDER BY name LIMIT :limit") suspend fun searchCatalog(providerId: String, kind: String, query: String, limit: Int = 300): List<StreamEntity>

    @Query("SELECT * FROM streams WHERE key = :contentKey LIMIT 1") suspend fun stream(contentKey: String): StreamEntity?
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND favorite = 1 ORDER BY name") fun favorites(providerId: String): Flow<List<StreamEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND name LIKE '%' || :query || '%' ORDER BY name LIMIT :limit") suspend fun searchStreams(providerId: String, query: String, limit: Int = 80): List<StreamEntity>
    @Query("UPDATE streams SET favorite = :favorite WHERE key = :contentKey") suspend fun setFavorite(contentKey: String, favorite: Boolean)
    @Query("UPDATE streams SET locked = :locked WHERE key = :contentKey") suspend fun setLocked(contentKey: String, locked: Boolean)

    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId ORDER BY season, episode") fun episodes(providerId: String, seriesId: String): Flow<List<EpisodeEntity>>
    @Query("SELECT * FROM episodes WHERE key = :contentKey LIMIT 1") suspend fun episode(contentKey: String): EpisodeEntity?
    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND endMs >= :nowMs ORDER BY startMs LIMIT :limit") fun epg(providerId: String, streamId: String, nowMs: Long, limit: Int = 20): Flow<List<EpgEntity>>
    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND startMs >= :sinceMs AND endMs <= :nowMs ORDER BY startMs DESC LIMIT :limit") suspend fun catchupEpg(providerId: String, streamId: String, sinceMs: Long, nowMs: Long, limit: Int = 300): List<EpgEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveWatchState(state: WatchStateEntity)
    @Query("SELECT * FROM watch_state WHERE contentKey = :contentKey LIMIT 1") suspend fun watchState(contentKey: String): WatchStateEntity?
    @Query("SELECT * FROM watch_state WHERE providerId = :providerId") suspend fun watchStates(providerId: String): List<WatchStateEntity>
    @Query("SELECT * FROM watch_state WHERE providerId = :providerId AND completed = 0 AND positionMs > 0 ORDER BY updatedAt DESC LIMIT :limit") fun continueWatching(providerId: String, limit: Int = 30): Flow<List<WatchStateEntity>>

    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind = :kind") suspend fun clearCategories(providerId: String, kind: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun clearStreams(providerId: String, kind: String)
    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')") suspend fun clearM3uCategories(providerId: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')") suspend fun clearM3uStreams(providerId: String)
    @Query("DELETE FROM episodes WHERE providerId = :providerId") suspend fun clearProviderEpisodes(providerId: String)
    @Query("DELETE FROM categories WHERE providerId = :providerId") suspend fun clearProviderCategories(providerId: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId") suspend fun clearProviderStreams(providerId: String)
    @Query("DELETE FROM epg WHERE providerId = :providerId") suspend fun clearProviderEpg(providerId: String)

    @Transaction suspend fun clearProviderCatalog(providerId: String) { clearProviderCategories(providerId); clearProviderStreams(providerId); clearProviderEpisodes(providerId); clearProviderEpg(providerId) }
    @Transaction suspend fun discardStagedCatalog(stagedProviderId: String) { clearProviderCatalog(stagedProviderId); deleteProvider(stagedProviderId) }

    @Query("""UPDATE categories SET hidden = COALESCE((SELECT old.hidden FROM categories AS old WHERE old.`key` = :targetProviderId || ':' || categories.kind || ':' || categories.remoteId LIMIT 1),(SELECT old.hidden FROM categories AS old WHERE old.`key` = :targetProviderId || ':' || categories.kind || ':' || categories.remoteId || '.0' LIMIT 1),categories.hidden) WHERE providerId = :stagedProviderId""") suspend fun inheritStagedCategoryFlags(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE streams SET favorite = COALESCE((SELECT old.favorite FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId LIMIT 1),(SELECT old.favorite FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId || '.0' LIMIT 1),streams.favorite), locked = COALESCE((SELECT old.locked FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId LIMIT 1),(SELECT old.locked FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId || '.0' LIMIT 1),streams.locked) WHERE providerId = :stagedProviderId""") suspend fun inheritStagedStreamFlags(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE categories SET providerId = :targetProviderId, `key` = :targetProviderId || ':' || kind || ':' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedCategoriesInPlace(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE streams SET providerId = :targetProviderId, `key` = :targetProviderId || ':' || kind || ':' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedStreamsInPlace(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE episodes SET providerId = :targetProviderId, `key` = :targetProviderId || ':episode:' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedEpisodesInPlace(stagedProviderId: String, targetProviderId: String)

    @Transaction
    suspend fun promoteStagedCatalog(stagedProviderId: String, targetProvider: ProviderEntity) {
        inheritStagedCategoryFlags(stagedProviderId, targetProvider.id); inheritStagedStreamFlags(stagedProviderId, targetProvider.id)
        clearProviderCatalog(targetProvider.id)
        promoteStagedCategoriesInPlace(stagedProviderId, targetProvider.id); promoteStagedStreamsInPlace(stagedProviderId, targetProvider.id); promoteStagedEpisodesInPlace(stagedProviderId, targetProvider.id); clearProviderEpg(stagedProviderId)
        upsertProvider(targetProvider.copy(enabled = true)); disableAllProviders(); activateProvider(targetProvider.id, targetProvider.updatedAt); deleteProvider(stagedProviderId)
    }

    @Transaction suspend fun replaceCatalog(providerId: String, kind: String, categories: List<CategoryEntity>, streams: List<StreamEntity>) { clearCategories(providerId, kind); clearStreams(providerId, kind); if (categories.isNotEmpty()) upsertCategories(categories); streams.chunked(CATALOG_INSERT_BATCH_SIZE).forEach { upsertStreams(it) } }
    @Transaction suspend fun replaceM3uCatalog(providerId: String, categories: List<CategoryEntity>, streams: List<StreamEntity>, episodes: List<EpisodeEntity>) { clearM3uCategories(providerId); clearM3uStreams(providerId); clearProviderEpisodes(providerId); if (categories.isNotEmpty()) upsertCategories(categories); streams.chunked(CATALOG_INSERT_BATCH_SIZE).forEach { upsertStreams(it) }; episodes.chunked(CATALOG_INSERT_BATCH_SIZE).forEach { upsertEpisodes(it) } }
    @Query("DELETE FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId") suspend fun clearEpisodes(providerId: String, seriesId: String)
    @Transaction suspend fun replaceEpisodes(providerId: String, seriesId: String, episodes: List<EpisodeEntity>) { clearEpisodes(providerId, seriesId); if (episodes.isNotEmpty()) upsertEpisodes(episodes) }
    @Query("DELETE FROM epg WHERE providerId = :providerId AND streamId = :streamId") suspend fun clearEpg(providerId: String, streamId: String)
}

private const val CATALOG_INSERT_BATCH_SIZE = 1000
