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

    @Transaction
    suspend fun saveAndActivateProvider(provider: ProviderEntity) {
        upsertProvider(provider.copy(enabled = true))
        disableAllProviders()
        activateProvider(provider.id, provider.updatedAt)
    }

    @Query("SELECT * FROM categories WHERE providerId = :providerId")
    suspend fun allCategoriesForProvider(providerId: String): List<CategoryEntity>

    @Query("SELECT * FROM streams WHERE providerId = :providerId")
    suspend fun allStreamsForProvider(providerId: String): List<StreamEntity>

    @Query("SELECT * FROM episodes WHERE providerId = :providerId")
    suspend fun allEpisodesForProvider(providerId: String): List<EpisodeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertCategories(items: List<CategoryEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertStreams(items: List<StreamEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpisodes(items: List<EpisodeEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpg(items: List<EpgEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertActivation(state: ActivationEntity)
    @Query("SELECT * FROM activation LIMIT 1") suspend fun activation(): ActivationEntity?
    @Query("DELETE FROM activation") suspend fun clearActivation()

    @Transaction
    suspend fun replaceActivation(state: ActivationEntity) {
        clearActivation()
        upsertActivation(state)
    }

    @Query("SELECT * FROM categories WHERE providerId = :providerId AND kind = :kind AND hidden = 0 ORDER BY orderIndex, name")
    fun categories(providerId: String, kind: String): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (:categoryId IS NULL OR categoryId = :categoryId) ORDER BY name")
    fun streams(providerId: String, kind: String, categoryId: String?): Flow<List<StreamEntity>>

    @Query("SELECT * FROM streams WHERE key = :contentKey LIMIT 1") suspend fun stream(contentKey: String): StreamEntity?
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND favorite = 1 ORDER BY name") fun favorites(providerId: String): Flow<List<StreamEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND name LIKE '%' || :query || '%' ORDER BY name LIMIT :limit") suspend fun searchStreams(providerId: String, query: String, limit: Int = 80): List<StreamEntity>
    @Query("UPDATE streams SET favorite = :favorite WHERE key = :contentKey") suspend fun setFavorite(contentKey: String, favorite: Boolean)
    @Query("UPDATE streams SET locked = :locked WHERE key = :contentKey") suspend fun setLocked(contentKey: String, locked: Boolean)

    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId ORDER BY season, episode")
    fun episodes(providerId: String, seriesId: String): Flow<List<EpisodeEntity>>
    @Query("SELECT * FROM episodes WHERE key = :contentKey LIMIT 1")
    suspend fun episode(contentKey: String): EpisodeEntity?

    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND endMs >= :nowMs ORDER BY startMs LIMIT :limit")
    fun epg(providerId: String, streamId: String, nowMs: Long, limit: Int = 20): Flow<List<EpgEntity>>

    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND startMs >= :sinceMs AND endMs <= :nowMs ORDER BY startMs DESC LIMIT :limit")
    suspend fun catchupEpg(providerId: String, streamId: String, sinceMs: Long, nowMs: Long, limit: Int = 300): List<EpgEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveWatchState(state: WatchStateEntity)
    @Query("SELECT * FROM watch_state WHERE contentKey = :contentKey LIMIT 1") suspend fun watchState(contentKey: String): WatchStateEntity?
    @Query("SELECT * FROM watch_state WHERE providerId = :providerId AND completed = 0 AND positionMs > 0 ORDER BY updatedAt DESC LIMIT :limit") fun continueWatching(providerId: String, limit: Int = 30): Flow<List<WatchStateEntity>>

    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind = :kind") suspend fun clearCategories(providerId: String, kind: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun clearStreams(providerId: String, kind: String)
    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')")
    suspend fun clearM3uCategories(providerId: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')")
    suspend fun clearM3uStreams(providerId: String)
    @Query("DELETE FROM episodes WHERE providerId = :providerId")
    suspend fun clearProviderEpisodes(providerId: String)

    @Query("DELETE FROM categories WHERE providerId = :providerId")
    suspend fun clearProviderCategories(providerId: String)

    @Query("DELETE FROM streams WHERE providerId = :providerId")
    suspend fun clearProviderStreams(providerId: String)

    @Query("DELETE FROM epg WHERE providerId = :providerId")
    suspend fun clearProviderEpg(providerId: String)

    @Transaction
    suspend fun discardStagedCatalog(stagedProviderId: String) {
        clearProviderCategories(stagedProviderId)
        clearProviderStreams(stagedProviderId)
        clearProviderEpisodes(stagedProviderId)
        clearProviderEpg(stagedProviderId)
        deleteProvider(stagedProviderId)
    }

    /**
     * Atomically promotes a fully validated staging catalog to the stable portal provider ID.
     * The old catalog remains readable until this transaction begins, and matching favorites,
     * locks and hidden-category choices survive credential refreshes.
     */
    @Transaction
    suspend fun promoteStagedCatalog(stagedProviderId: String, targetProvider: ProviderEntity) {
        val oldCategories = allCategoriesForProvider(targetProvider.id)
            .associateBy { "${it.kind}:${legacyCatalogId(it.remoteId)}" }
        val oldStreams = allStreamsForProvider(targetProvider.id)
            .associateBy { "${it.kind}:${legacyCatalogId(it.remoteId)}" }
        val stagedCategories = allCategoriesForProvider(stagedProviderId)
        val stagedStreams = allStreamsForProvider(stagedProviderId)
        val stagedEpisodes = allEpisodesForProvider(stagedProviderId)

        clearProviderCategories(targetProvider.id)
        clearProviderStreams(targetProvider.id)
        clearProviderEpisodes(targetProvider.id)
        clearProviderEpg(targetProvider.id)

        val promotedCategories = stagedCategories.map { category ->
            val old = oldCategories["${category.kind}:${legacyCatalogId(category.remoteId)}"]
            category.copy(
                key = "${targetProvider.id}:${category.kind}:${category.remoteId}",
                providerId = targetProvider.id,
                hidden = old?.hidden ?: category.hidden
            )
        }
        val promotedStreams = stagedStreams.map { stream ->
            val old = oldStreams["${stream.kind}:${legacyCatalogId(stream.remoteId)}"]
            stream.copy(
                key = "${targetProvider.id}:${stream.kind}:${stream.remoteId}",
                providerId = targetProvider.id,
                favorite = old?.favorite ?: stream.favorite,
                locked = old?.locked ?: stream.locked
            )
        }
        val promotedEpisodes = stagedEpisodes.map { episode ->
            episode.copy(
                key = "${targetProvider.id}:episode:${episode.remoteId}",
                providerId = targetProvider.id
            )
        }

        if (promotedCategories.isNotEmpty()) upsertCategories(promotedCategories)
        if (promotedStreams.isNotEmpty()) upsertStreams(promotedStreams)
        if (promotedEpisodes.isNotEmpty()) upsertEpisodes(promotedEpisodes)
        upsertProvider(targetProvider.copy(enabled = true))
        disableAllProviders()
        activateProvider(targetProvider.id, targetProvider.updatedAt)
        discardStagedCatalog(stagedProviderId)
    }

    @Transaction
    suspend fun replaceCatalog(
        providerId: String,
        kind: String,
        categories: List<CategoryEntity>,
        streams: List<StreamEntity>
    ) {
        clearCategories(providerId, kind)
        clearStreams(providerId, kind)
        if (categories.isNotEmpty()) upsertCategories(categories)
        if (streams.isNotEmpty()) upsertStreams(streams)
    }

    @Transaction
    suspend fun replaceM3uCatalog(
        providerId: String,
        categories: List<CategoryEntity>,
        streams: List<StreamEntity>,
        episodes: List<EpisodeEntity>
    ) {
        clearM3uCategories(providerId)
        clearM3uStreams(providerId)
        clearProviderEpisodes(providerId)
        if (categories.isNotEmpty()) upsertCategories(categories)
        if (streams.isNotEmpty()) upsertStreams(streams)
        if (episodes.isNotEmpty()) upsertEpisodes(episodes)
    }

    @Query("DELETE FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId") suspend fun clearEpisodes(providerId: String, seriesId: String)

    @Transaction
    suspend fun replaceEpisodes(providerId: String, seriesId: String, episodes: List<EpisodeEntity>) {
        clearEpisodes(providerId, seriesId)
        if (episodes.isNotEmpty()) upsertEpisodes(episodes)
    }

    @Query("DELETE FROM epg WHERE providerId = :providerId AND streamId = :streamId") suspend fun clearEpg(providerId: String, streamId: String)
}

private val LEGACY_DECIMAL_CATALOG_ID = Regex("[+-]?\\d+\\.0+")

private fun legacyCatalogId(value: String): String {
    val trimmed = value.trim()
    return if (LEGACY_DECIMAL_CATALOG_ID.matches(trimmed)) trimmed.substringBefore('.') else trimmed
}
