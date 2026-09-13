package tv.blofy.player.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.CatalogRefreshIntegrityPolicy

@Dao
interface BlofyDao {

    /** Replace transport credentials and cached proxy links atomically, retaining IDs and history. */
    @Transaction suspend fun migrateSubscriberConnection(expected: ProviderEntity, direct: ProviderEntity): Boolean {
        val current = provider(expected.id) ?: return false
        if (!sameCatalogSource(current, expected) || current.subscriberToken.isNotEmpty() ||
            direct.id != current.id || direct.subscriberToken != expected.username) return false
        val proxyPrefix = expected.baseUrl.trimEnd('/') + "/"
        rewriteSubscriberStreamUrls(current.id, proxyPrefix, proxyPrefix + "raw/", direct.baseUrl.trimEnd('/'))
        rewriteSubscriberEpisodeUrls(current.id, proxyPrefix, proxyPrefix + "raw/", direct.baseUrl.trimEnd('/'))
        upsertProvider(current.copy(baseUrl = direct.baseUrl, username = direct.username,
            password = direct.password, subscriberToken = direct.subscriberToken))
        return true
    }

    @Query("""
        UPDATE streams SET
            icon = CASE WHEN substr(icon, 1, length(:rawPrefix)) = :rawPrefix AND instr(substr(icon, length(:rawPrefix) + 1), '/') > 0 THEN :directBase || substr(icon, length(:rawPrefix) + instr(substr(icon, length(:rawPrefix) + 1), '/')) WHEN substr(icon, 1, length(:proxyPrefix)) = :proxyPrefix THEN NULL ELSE icon END,
            backdrop = CASE WHEN substr(backdrop, 1, length(:rawPrefix)) = :rawPrefix AND instr(substr(backdrop, length(:rawPrefix) + 1), '/') > 0 THEN :directBase || substr(backdrop, length(:rawPrefix) + instr(substr(backdrop, length(:rawPrefix) + 1), '/')) WHEN substr(backdrop, 1, length(:proxyPrefix)) = :proxyPrefix THEN NULL ELSE backdrop END,
            directSource = CASE WHEN substr(directSource, 1, length(:rawPrefix)) = :rawPrefix AND instr(substr(directSource, length(:rawPrefix) + 1), '/') > 0 THEN :directBase || substr(directSource, length(:rawPrefix) + instr(substr(directSource, length(:rawPrefix) + 1), '/')) WHEN substr(directSource, 1, length(:proxyPrefix)) = :proxyPrefix THEN NULL ELSE directSource END
        WHERE providerId = :providerId AND
            (substr(icon, 1, length(:proxyPrefix)) = :proxyPrefix OR
             substr(backdrop, 1, length(:proxyPrefix)) = :proxyPrefix OR
             substr(directSource, 1, length(:proxyPrefix)) = :proxyPrefix)
    """)
    suspend fun rewriteSubscriberStreamUrls(providerId: String, proxyPrefix: String, rawPrefix: String, directBase: String)

    @Query("""
        UPDATE episodes SET directSource = CASE WHEN substr(directSource, 1, length(:rawPrefix)) = :rawPrefix AND instr(substr(directSource, length(:rawPrefix) + 1), '/') > 0 THEN :directBase || substr(directSource, length(:rawPrefix) + instr(substr(directSource, length(:rawPrefix) + 1), '/')) WHEN substr(directSource, 1, length(:proxyPrefix)) = :proxyPrefix THEN NULL ELSE directSource END
        WHERE providerId = :providerId AND substr(directSource, 1, length(:proxyPrefix)) = :proxyPrefix
    """)
    suspend fun rewriteSubscriberEpisodeUrls(providerId: String, proxyPrefix: String, rawPrefix: String, directBase: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertProviderStored(provider: ProviderEntity)
    @Transaction suspend fun upsertProvider(provider: ProviderEntity) =
        upsertProviderStored(ProviderSecretCodec.sealForUpdate(provider, providerStored(provider.id)))

    @Query("SELECT * FROM providers WHERE enabled = 1 ORDER BY updatedAt DESC") fun providersStored(): Flow<List<ProviderEntity>>
    fun providers(): Flow<List<ProviderEntity>> = providersStored()
        .map { rows -> rows.map(ProviderSecretCodec::open) }.flowOn(Dispatchers.IO)

    @Query("SELECT * FROM providers ORDER BY updatedAt DESC") fun allProvidersStored(): Flow<List<ProviderEntity>>
    fun allProviders(): Flow<List<ProviderEntity>> = allProvidersStored()
        .map { rows -> rows.map(ProviderSecretCodec::open) }.flowOn(Dispatchers.IO)

    @Query("SELECT id FROM providers WHERE enabled = 1 ORDER BY updatedAt DESC LIMIT 1")
    suspend fun activeProviderId(): String?

    @Query("SELECT * FROM providers WHERE id = :providerId LIMIT 1") suspend fun providerStored(providerId: String): ProviderEntity?
    suspend fun provider(providerId: String): ProviderEntity? = providerStored(providerId)?.let(ProviderSecretCodec::open)

    @Query("SELECT * FROM providers ORDER BY updatedAt DESC") suspend fun providerSnapshotStored(): List<ProviderEntity>

    /** Encrypt legacy plaintext provider rows after Home is already interactive. */
    @Transaction suspend fun hardenProviderSecrets() {
        providerSnapshotStored().forEach { stored ->
            if (ProviderSecretCodec.needsSealing(stored)) {
                // Seal only plaintext fields. Decrypting first could erase an existing encrypted
                // field if Keystore is temporarily unavailable on a partially migrated row.
                val hardened = ProviderSecretCodec.seal(stored)
                if (hardened != stored) upsertProviderStored(hardened)
            }
        }
    }

    @Query("UPDATE providers SET enabled = 0 WHERE id = :providerId") suspend fun deactivateProvider(providerId: String)
    @Query("UPDATE providers SET enabled = 0") suspend fun disableAllProviders()
    @Query("UPDATE providers SET enabled = 1, updatedAt = :updatedAt WHERE id = :providerId") suspend fun activateProvider(providerId: String, updatedAt: Long = System.currentTimeMillis())
    @Query("DELETE FROM providers WHERE id = :providerId") suspend fun deleteProvider(providerId: String)

    @Transaction suspend fun saveAndActivateProvider(provider: ProviderEntity) {
        upsertProvider(provider.copy(enabled = true))
        disableAllProviders()
        activateProvider(provider.id, provider.updatedAt)
    }

    @Transaction suspend fun activateExistingProvider(providerId: String) {
        val current = checkNotNull(providerStored(providerId)) { "Provider no longer exists" }
        disableAllProviders()
        activateProvider(providerId, current.updatedAt)
    }

    @Transaction suspend fun activateImportedProvider(
        expectedSource: ProviderEntity,
        updatedAt: Long = System.currentTimeMillis()
    ) {
        val current = checkNotNull(provider(expectedSource.id)) { "Provider no longer exists" }
        check(sameCatalogSource(current, expectedSource)) { "Provider source changed during import" }
        saveAndActivateProvider(current.copy(enabled = true, updatedAt = maxOf(current.updatedAt, updatedAt)))
    }

    @Transaction suspend fun mergeProviderProfileIfSourceUnchanged(
        expected: ProviderEntity,
        updated: ProviderEntity
    ): Boolean {
        val current = provider(expected.id) ?: return false
        if (expected.id != updated.id || !sameCatalogSource(current, expected)) return false
        // Network profile results may arrive after a selection, rename or preference edit.
        // Apply each default only while that field still has the value seen by the request.
        val merged = current.copy(
            liveFormat = if (current.liveFormat == expected.liveFormat) updated.liveFormat else current.liveFormat,
            preferredTransport = if (current.preferredTransport == expected.preferredTransport) updated.preferredTransport else current.preferredTransport,
            preferredEngine = if (current.preferredEngine == expected.preferredEngine) updated.preferredEngine else current.preferredEngine,
            allowCrossProtocolRedirects = if (current.allowCrossProtocolRedirects == expected.allowCrossProtocolRedirects) updated.allowCrossProtocolRedirects else current.allowCrossProtocolRedirects
        )
        if (merged != current) upsertProvider(merged)
        return true
    }

    @Transaction suspend fun discardUncommittedCatalogIfSourceUnchanged(
        expectedSource: ProviderEntity,
        completedSections: Set<String> = emptySet(),
        canDiscard: () -> Boolean = { true }
    ): Boolean {
        val current = provider(expectedSource.id) ?: return false
        if (!sameCatalogSource(current, expectedSource) || current.updatedAt != expectedSource.updatedAt || !canDiscard()) return false
        if (completedSections.isEmpty()) clearProviderCatalog(expectedSource.id)
        else for (kind in listOf("live", "movie", "series")) {
            if (kind !in completedSections) {
                clearSearchIndex(expectedSource.id, kind)
                clearStreams(expectedSource.id, kind)
                clearCategories(expectedSource.id, kind)
                if (kind == "series") clearProviderEpisodes(expectedSource.id)
            }
        }
        return true
    }

    @Query("SELECT * FROM categories WHERE providerId = :providerId") suspend fun allCategoriesForProvider(providerId: String): List<CategoryEntity>
    @Query("SELECT * FROM categories WHERE providerId = :providerId AND kind = :kind") suspend fun categorySnapshot(providerId: String, kind: String): List<CategoryEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId") suspend fun allStreamsForProvider(providerId: String): List<StreamEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun streamSnapshot(providerId: String, kind: String): List<StreamEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (favorite = 1 OR locked = 1)") suspend fun persistedStreamFlags(providerId: String, kind: String): List<StreamEntity>
    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId") suspend fun streamCountForProvider(providerId: String): Int
    @Query("SELECT EXISTS(SELECT 1 FROM streams WHERE providerId = :providerId LIMIT 1)") suspend fun hasStreamsForProvider(providerId: String): Boolean
    suspend fun hasCatalog(providerId: String): Boolean = hasStreamsForProvider(providerId)
    @Query("SELECT * FROM episodes WHERE providerId = :providerId") suspend fun allEpisodesForProvider(providerId: String): List<EpisodeEntity>
    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId") suspend fun episodeSnapshot(providerId: String, seriesId: String): List<EpisodeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertCategories(items: List<CategoryEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertStreams(items: List<StreamEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpisodes(items: List<EpisodeEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertEpg(items: List<EpgEntity>)
    @Insert suspend fun insertSearchRows(items: List<StreamSearchFtsEntity>)
    @Query("SELECT EXISTS(SELECT 1 FROM streams_fts WHERE providerId = :providerId LIMIT 1)")
    suspend fun hasSearchIndex(providerId: String): Boolean
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsertActivation(state: ActivationEntity)
    @Query("SELECT * FROM activation LIMIT 1") suspend fun activation(): ActivationEntity?
    @Query("DELETE FROM activation") suspend fun clearActivation()
    @Transaction suspend fun replaceActivation(state: ActivationEntity) { clearActivation(); upsertActivation(state) }

    @Query("SELECT * FROM categories WHERE providerId = :providerId AND kind = :kind AND hidden = 0 ORDER BY orderIndex, name") fun categories(providerId: String, kind: String): Flow<List<CategoryEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (:categoryId IS NULL OR categoryId = :categoryId) ORDER BY name") fun streams(providerId: String, kind: String, categoryId: String?): Flow<List<StreamEntity>>

    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun catalogCountAll(providerId: String, kind: String): Int
    @Query("SELECT COUNT(*) FROM streams WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId") suspend fun catalogCountInCategory(providerId: String, kind: String, categoryId: String): Int

    @Query("SELECT * FROM streams INDEXED BY index_streams_providerId_kind WHERE providerId = :providerId AND kind = :kind AND rowid > :afterRowId ORDER BY rowid LIMIT :limit")
    suspend fun catalogPageAfterAll(providerId: String, kind: String, afterRowId: Long, limit: Int): List<StreamEntity>

    @Query("SELECT * FROM streams INDEXED BY index_streams_providerId_kind_categoryId WHERE providerId = :providerId AND kind = :kind AND categoryId = :categoryId AND rowid > :afterRowId ORDER BY rowid LIMIT :limit")
    suspend fun catalogPageAfterInCategory(providerId: String, kind: String, categoryId: String, afterRowId: Long, limit: Int): List<StreamEntity>

    @Query("SELECT rowid FROM streams WHERE `key` = :contentKey LIMIT 1")
    suspend fun streamRowId(contentKey: String): Long?

    // Each covering-index seek reads at most `limit` keys. Merge only those four small sets,
    // then load the selected rows. Keep the existing NULL-as-zero date and name ordering.
    @Query("""
        WITH candidates AS (
            SELECT * FROM (SELECT `key`, name, addedAt FROM streams INDEXED BY index_streams_home_page
                WHERE providerId = :providerId AND kind = 'movie' AND addedAt IS NOT NULL
                ORDER BY addedAt DESC, name, `key` LIMIT :limit)
            UNION ALL
            SELECT * FROM (SELECT `key`, name, addedAt FROM streams INDEXED BY index_streams_home_page
                WHERE providerId = :providerId AND kind = 'series' AND addedAt IS NOT NULL
                ORDER BY addedAt DESC, name, `key` LIMIT :limit)
            UNION ALL
            SELECT * FROM (SELECT `key`, name, addedAt FROM streams INDEXED BY index_streams_home_page
                WHERE providerId = :providerId AND kind = 'movie' AND addedAt IS NULL
                ORDER BY name, `key` LIMIT :limit)
            UNION ALL
            SELECT * FROM (SELECT `key`, name, addedAt FROM streams INDEXED BY index_streams_home_page
                WHERE providerId = :providerId AND kind = 'series' AND addedAt IS NULL
                ORDER BY name, `key` LIMIT :limit)
        )
        SELECT streams.* FROM streams INNER JOIN (
            SELECT `key` FROM candidates ORDER BY COALESCE(addedAt, 0) DESC, name, `key` LIMIT :limit
        ) AS selected ON streams.`key` = selected.`key`
        ORDER BY COALESCE(streams.addedAt, 0) DESC, streams.name, streams.`key`
    """)
    suspend fun latestHomeStreams(providerId: String, limit: Int = 14): List<StreamEntity>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND (name LIKE '%' || :query || '%' OR genre LIKE '%' || :query || '%' OR year LIKE '%' || :query || '%') ORDER BY name LIMIT :limit") suspend fun searchCatalog(providerId: String, kind: String, query: String, limit: Int = 300): List<StreamEntity>

    @Query("SELECT * FROM streams WHERE `key` = :contentKey LIMIT 1") suspend fun stream(contentKey: String): StreamEntity?
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND kind = :kind AND remoteId = :remoteId LIMIT 1") suspend fun streamByIdentity(providerId: String, kind: String, remoteId: String): StreamEntity?
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND favorite = 1 ORDER BY name") fun favorites(providerId: String): Flow<List<StreamEntity>>
    @Query("SELECT * FROM streams WHERE providerId = :providerId AND name LIKE '%' || :query || '%' ORDER BY name LIMIT :limit") suspend fun searchStreams(providerId: String, query: String, limit: Int = 80): List<StreamEntity>
    @Query("""
        SELECT streams.* FROM streams
        INNER JOIN streams_fts ON streams.`key` = streams_fts.contentKey
        WHERE streams_fts.providerId = :providerId AND streams_fts MATCH :query
        ORDER BY streams.name LIMIT :limit
    """)
    suspend fun searchStreamsFts(providerId: String, query: String, limit: Int = 100): List<StreamEntity>
    @Query("""
        SELECT streams.* FROM streams
        INNER JOIN streams_fts ON streams.`key` = streams_fts.contentKey
        WHERE streams_fts.providerId = :providerId AND streams_fts.kind = :kind AND streams_fts MATCH :query
        ORDER BY streams.name LIMIT :limit
    """)
    suspend fun searchStreamsFtsByKind(providerId: String, kind: String, query: String, limit: Int): List<StreamEntity>
    @Query("UPDATE streams SET favorite = :favorite WHERE `key` = :contentKey") suspend fun setFavorite(contentKey: String, favorite: Boolean)
    @Query("UPDATE streams SET favorite = :favorite WHERE providerId = :providerId AND kind = :kind AND remoteId = :remoteId") suspend fun setFavoriteByIdentity(providerId: String, kind: String, remoteId: String, favorite: Boolean)
    @Query("UPDATE streams SET locked = :locked WHERE `key` = :contentKey") suspend fun setLocked(contentKey: String, locked: Boolean)

    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId ORDER BY season, episode") fun episodes(providerId: String, seriesId: String): Flow<List<EpisodeEntity>>
    @Query("SELECT * FROM episodes WHERE `key` = :contentKey LIMIT 1") suspend fun episode(contentKey: String): EpisodeEntity?
    @Query("SELECT * FROM episodes WHERE providerId = :providerId AND remoteId = :remoteId LIMIT 1") suspend fun episodeByRemoteId(providerId: String, remoteId: String): EpisodeEntity?
    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND endMs >= :nowMs ORDER BY startMs LIMIT :limit") fun epg(providerId: String, streamId: String, nowMs: Long, limit: Int = 20): Flow<List<EpgEntity>>
    @Query("SELECT * FROM epg WHERE providerId = :providerId AND streamId = :streamId AND startMs >= :sinceMs AND endMs <= :nowMs ORDER BY startMs DESC LIMIT :limit") suspend fun catchupEpg(providerId: String, streamId: String, sinceMs: Long, nowMs: Long, limit: Int = 300): List<EpgEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveWatchState(state: WatchStateEntity)
    @Query("SELECT * FROM watch_state WHERE contentKey = :contentKey LIMIT 1") suspend fun watchState(contentKey: String): WatchStateEntity?
    @Query("SELECT w.* FROM watch_state w INNER JOIN episodes e ON e.`key` = w.contentKey WHERE e.providerId = :providerId AND e.seriesId = :seriesId")
    suspend fun watchStatesForSeries(providerId: String, seriesId: String): List<WatchStateEntity>

    @Query("SELECT * FROM watch_state WHERE providerId = :providerId") suspend fun watchStates(providerId: String): List<WatchStateEntity>
    @Query("SELECT * FROM watch_state WHERE providerId = :providerId AND completed = 0 AND positionMs > 0 ORDER BY updatedAt DESC LIMIT :limit") fun continueWatching(providerId: String, limit: Int = 30): Flow<List<WatchStateEntity>>

    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind = :kind") suspend fun clearCategories(providerId: String, kind: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind = :kind") suspend fun clearStreams(providerId: String, kind: String)
    @Query("DELETE FROM categories WHERE `key` IN (:keys)") suspend fun deleteCategoriesByKeys(keys: List<String>)
    @Query("DELETE FROM streams WHERE `key` IN (:keys)") suspend fun deleteStreamsByKeys(keys: List<String>)
    @Query("DELETE FROM episodes WHERE `key` IN (:keys)") suspend fun deleteEpisodesByKeys(keys: List<String>)
    @Query("DELETE FROM categories WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')") suspend fun clearM3uCategories(providerId: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId AND kind IN ('live', 'movie', 'series')") suspend fun clearM3uStreams(providerId: String)
    @Query("DELETE FROM episodes WHERE providerId = :providerId") suspend fun clearProviderEpisodes(providerId: String)
    @Query("DELETE FROM categories WHERE providerId = :providerId") suspend fun clearProviderCategories(providerId: String)
    @Query("DELETE FROM streams WHERE providerId = :providerId") suspend fun clearProviderStreams(providerId: String)
    @Query("DELETE FROM epg WHERE providerId = :providerId") suspend fun clearProviderEpg(providerId: String)
    @Query("DELETE FROM streams_fts WHERE providerId = :providerId") suspend fun clearSearchIndex(providerId: String)
    @Query("DELETE FROM streams_fts WHERE providerId = :providerId AND kind = :kind") suspend fun clearSearchIndex(providerId: String, kind: String)

    @Transaction
    suspend fun clearProviderCatalog(providerId: String) {
        clearProviderCategories(providerId)
        clearProviderStreams(providerId)
        clearProviderEpisodes(providerId)
        clearProviderEpg(providerId)
        clearSearchIndex(providerId)
    }

    @Transaction suspend fun discardStagedCatalog(stagedProviderId: String) {
        clearProviderCatalog(stagedProviderId)
        deleteProvider(stagedProviderId)
    }

    @Query("""UPDATE categories SET hidden = COALESCE((SELECT old.hidden FROM categories AS old WHERE old.`key` = :targetProviderId || ':' || categories.kind || ':' || categories.remoteId LIMIT 1),(SELECT old.hidden FROM categories AS old WHERE old.`key` = :targetProviderId || ':' || categories.kind || ':' || categories.remoteId || '.0' LIMIT 1),categories.hidden) WHERE providerId = :stagedProviderId""") suspend fun inheritStagedCategoryFlags(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE streams SET favorite = COALESCE((SELECT old.favorite FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId LIMIT 1),(SELECT old.favorite FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId || '.0' LIMIT 1),streams.favorite), locked = COALESCE((SELECT old.locked FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId LIMIT 1),(SELECT old.locked FROM streams AS old WHERE old.`key` = :targetProviderId || ':' || streams.kind || ':' || streams.remoteId || '.0' LIMIT 1),streams.locked) WHERE providerId = :stagedProviderId""") suspend fun inheritStagedStreamFlags(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE categories SET providerId = :targetProviderId, `key` = :targetProviderId || ':' || kind || ':' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedCategoriesInPlace(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE streams SET providerId = :targetProviderId, `key` = :targetProviderId || ':' || kind || ':' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedStreamsInPlace(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE episodes SET providerId = :targetProviderId, `key` = :targetProviderId || ':episode:' || remoteId WHERE providerId = :stagedProviderId""") suspend fun promoteStagedEpisodesInPlace(stagedProviderId: String, targetProviderId: String)
    @Query("""UPDATE streams_fts SET providerId = :targetProviderId, contentKey = :targetProviderId || substr(contentKey, length(:stagedProviderId) + 1) WHERE providerId = :stagedProviderId""")
    suspend fun promoteStagedSearchIndexInPlace(stagedProviderId: String, targetProviderId: String)

    /** Same-source refreshes must validate the durable candidate before replacing known-good rows. */
    @Transaction
    suspend fun promoteStagedRefresh(
        stagedProviderId: String,
        targetProvider: ProviderEntity,
        activateTarget: Boolean = true,
        expectedSource: ProviderEntity? = null
    ) {
        val current = provider(targetProvider.id)
        if (expectedSource != null) {
            check(expectedSource.id == targetProvider.id) { "Catalog target changed" }
            checkNotNull(current) { "Provider no longer exists" }
            check(sameCatalogSource(current, expectedSource)) { "Provider source changed during refresh" }
        }
        val target = if (expectedSource != null && current != null) current.copy(
            baseUrl = targetProvider.baseUrl,
            username = targetProvider.username,
            password = targetProvider.password,
            providerType = targetProvider.providerType,
            updatedAt = maxOf(current.updatedAt, targetProvider.updatedAt)
        ) else targetProvider
        val previous = CatalogRefreshIntegrityPolicy.Counts(
            live = catalogCountAll(targetProvider.id, "live"),
            movies = catalogCountAll(targetProvider.id, "movie"),
            series = catalogCountAll(targetProvider.id, "series")
        )
        val candidate = CatalogRefreshIntegrityPolicy.Counts(
            live = catalogCountAll(stagedProviderId, "live"),
            movies = catalogCountAll(stagedProviderId, "movie"),
            series = catalogCountAll(stagedProviderId, "series")
        )
        check(CatalogRefreshIntegrityPolicy.accepts(previous, candidate)) { "Incomplete catalog refresh" }
        val sameSource = current?.let { sameCatalogSource(it, target) } == true
        promoteStagedCatalog(stagedProviderId, target, activateTarget, preserveEpisodes = sameSource)
    }

    /** A completed background request must not undo a later selection, edit or removal. */
    @Transaction
    suspend fun promoteStagedBackgroundRefresh(
        stagedProviderId: String,
        expectedProvider: ProviderEntity,
        refreshedProvider: ProviderEntity
    ) {
        check(expectedProvider.id == refreshedProvider.id) { "Catalog target changed" }
        val current = checkNotNull(provider(expectedProvider.id)) { "Provider no longer exists" }
        check(sameCatalogSource(current, expectedProvider)) { "Provider source changed during refresh" }
        val target = current.copy(
            baseUrl = refreshedProvider.baseUrl,
            username = refreshedProvider.username,
            password = refreshedProvider.password,
            providerType = refreshedProvider.providerType,
            updatedAt = maxOf(current.updatedAt, refreshedProvider.updatedAt)
        )
        promoteStagedRefresh(stagedProviderId, target, activateTarget = false)
    }

    /** Only an explicitly requested account replacement may legitimately have a smaller catalog. */
    @Transaction
    suspend fun promoteExplicitSourceReplacement(
        stagedProviderId: String,
        targetProvider: ProviderEntity,
        expectedSource: ProviderEntity
    ) {
        check(expectedSource.id == targetProvider.id && stagedProviderId != targetProvider.id) { "Catalog target changed" }
        val current = checkNotNull(provider(expectedSource.id)) { "Provider no longer exists" }
        check(sameCatalogSource(current, expectedSource)) { "Provider source changed during replacement" }
        check(!sameCatalogSource(current, targetProvider)) { "Replacement source is unchanged" }
        val candidate = CatalogRefreshIntegrityPolicy.Counts(
            live = catalogCountAll(stagedProviderId, "live"),
            movies = catalogCountAll(stagedProviderId, "movie"),
            series = catalogCountAll(stagedProviderId, "series")
        )
        check(candidate.total > 0) { "Replacement catalog is empty" }
        val target = current.copy(
            baseUrl = targetProvider.baseUrl,
            username = targetProvider.username,
            password = targetProvider.password,
            providerType = targetProvider.providerType,
            updatedAt = maxOf(current.updatedAt, targetProvider.updatedAt)
        )
        promoteStagedCatalog(stagedProviderId, target, activateTarget = true, preserveEpisodes = false)
    }

    @Query("""DELETE FROM episodes WHERE providerId = :targetProviderId AND (
        NOT EXISTS (SELECT 1 FROM streams WHERE streams.`key` =
            :targetProviderId || ':series:' || episodes.seriesId)
        OR EXISTS (SELECT 1 FROM episodes AS staged WHERE staged.`key` =
            :stagedProviderId || ':episode:' || episodes.remoteId))""")
    suspend fun pruneRetainedEpisodes(targetProviderId: String, stagedProviderId: String)

    @Transaction
    suspend fun promoteStagedCatalog(
        stagedProviderId: String,
        targetProvider: ProviderEntity,
        activateTarget: Boolean = true,
        preserveEpisodes: Boolean = false
    ) {
        inheritStagedCategoryFlags(stagedProviderId, targetProvider.id)
        inheritStagedStreamFlags(stagedProviderId, targetProvider.id)
        clearProviderCategories(targetProvider.id)
        clearProviderStreams(targetProvider.id)
        clearProviderEpg(targetProvider.id)
        clearSearchIndex(targetProvider.id)
        if (!preserveEpisodes) clearProviderEpisodes(targetProvider.id)
        promoteStagedCategoriesInPlace(stagedProviderId, targetProvider.id)
        promoteStagedStreamsInPlace(stagedProviderId, targetProvider.id)
        if (preserveEpisodes) pruneRetainedEpisodes(targetProvider.id, stagedProviderId)
        promoteStagedEpisodesInPlace(stagedProviderId, targetProvider.id)
        // The staged sync already built FTS section-by-section while data was arriving. Re-key the
        // staged FTS rows atomically instead of rebuilding the entire 100k–200k item index here.
        promoteStagedSearchIndexInPlace(stagedProviderId, targetProvider.id)
        clearProviderEpg(stagedProviderId)
        upsertProvider(targetProvider.copy(enabled = activateTarget || targetProvider.enabled))
        if (activateTarget) {
            disableAllProviders()
            activateProvider(targetProvider.id, targetProvider.updatedAt)
        }
        deleteProvider(stagedProviderId)
    }

    /**
     * Applies only changed rows and deletions. Xtream still returns a full section, but unchanged
     * rows are no longer deleted/reinserted, which keeps large libraries responsive and preserves
     * stable rowids used by keyset paging.
     *
     * Fresh staged catalogs take the direct path: there is nothing to diff, so avoid building huge
     * old/incoming maps and write the already parsed rows in bounded batches. Search rows are
     * generated alongside each stream batch so a 100k+ catalog never needs a second full pass or
     * a second catalog-sized allocation just to become searchable.
     */
    @Transaction
    suspend fun replaceCatalog(
        providerId: String,
        kind: String,
        categories: List<CategoryEntity>,
        streams: List<StreamEntity>
    ) {
        val oldCategoriesList = categorySnapshot(providerId, kind)
        val existingStreamCount = catalogCountAll(providerId, kind)

        if (existingStreamCount == 0 && oldCategoriesList.isEmpty()) {
            categories.asSequence().chunked(CATALOG_INSERT_BATCH_SIZE)
                .forEach { batch -> if (batch.isNotEmpty()) upsertCategories(batch) }
            clearSearchIndex(providerId, kind)
            streams.asSequence().chunked(SEARCH_INSERT_BATCH_SIZE).forEach { batch ->
                if (batch.isNotEmpty()) {
                    upsertStreams(batch)
                    insertSearchRows(batch.map(::searchRow))
                }
            }
            return
        }

        val oldCategories = oldCategoriesList.associateBy { it.key }
        val oldStreams = streamSnapshot(providerId, kind).associateBy { it.key }
        val incomingCategoryKeys = categories.asSequence().map { it.key }.toHashSet()
        val incomingStreamKeys = streams.asSequence().map { it.key }.toHashSet()

        oldCategories.keys.filterNot(incomingCategoryKeys::contains)
            .chunked(SQLITE_BIND_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) deleteCategoriesByKeys(it) }
        oldStreams.keys.filterNot(incomingStreamKeys::contains)
            .chunked(SQLITE_BIND_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) deleteStreamsByKeys(it) }

        categories.asSequence().filter { oldCategories[it.key] != it }
            .chunked(CATALOG_INSERT_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) upsertCategories(it) }
        streams.asSequence().filter { oldStreams[it.key] != it }
            .chunked(CATALOG_INSERT_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) upsertStreams(it) }

        rebuildSearchIndex(providerId, kind, streams)
    }

    @Transaction
    suspend fun replaceM3uCatalog(
        providerId: String,
        categories: List<CategoryEntity>,
        streams: List<StreamEntity>,
        episodes: List<EpisodeEntity>
    ) {
        listOf("live", "movie", "series").forEach { kind ->
            replaceCatalog(
                providerId,
                kind,
                categories.filter { it.kind == kind },
                streams.filter { it.kind == kind }
            )
        }
        val old = allEpisodesForProvider(providerId).associateBy { it.key }
        val incoming = episodes.associateBy { it.key }
        old.keys.filterNot(incoming::containsKey)
            .chunked(SQLITE_BIND_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) deleteEpisodesByKeys(it) }
        episodes.asSequence().filter { old[it.key] != it }
            .chunked(CATALOG_INSERT_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) upsertEpisodes(it) }
    }

    @Query("DELETE FROM episodes WHERE providerId = :providerId AND seriesId = :seriesId") suspend fun clearEpisodes(providerId: String, seriesId: String)

    @Transaction
    suspend fun replaceEpisodes(providerId: String, seriesId: String, episodes: List<EpisodeEntity>) {
        val old = episodeSnapshot(providerId, seriesId).associateBy { it.key }
        val incoming = episodes.associateBy { it.key }
        old.keys.filterNot(incoming::containsKey)
            .chunked(SQLITE_BIND_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) deleteEpisodesByKeys(it) }
        episodes.asSequence().filter { old[it.key] != it }
            .chunked(CATALOG_INSERT_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) upsertEpisodes(it) }
    }

    @Transaction
    suspend fun rebuildSearchIndex(providerId: String) {
        clearSearchIndex(providerId)
        for (kind in listOf("live", "movie", "series")) {
            var after = 0L
            while (true) {
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                val page = catalogPageAfterAll(providerId, kind, after, SEARCH_INSERT_BATCH_SIZE)
                if (page.isEmpty()) break
                insertSearchRows(page.map(::searchRow))
                val next = checkNotNull(streamRowId(page.last().key))
                check(next > after) { "Search index cursor did not advance" }
                after = next
            }
        }
    }

    @Transaction
    suspend fun rebuildSearchIndex(providerId: String, kind: String, streams: List<StreamEntity>) {
        clearSearchIndex(providerId, kind)
        streams.asSequence().map(::searchRow)
            .chunked(SEARCH_INSERT_BATCH_SIZE)
            .forEach { if (it.isNotEmpty()) insertSearchRows(it) }
    }

    @Query("DELETE FROM epg WHERE providerId = :providerId AND streamId = :streamId") suspend fun clearEpg(providerId: String, streamId: String)
}

private fun sameCatalogSource(first: ProviderEntity, second: ProviderEntity): Boolean =
    first.providerType.equals(second.providerType, ignoreCase = true) &&
        first.baseUrl.trimEnd('/') == second.baseUrl.trimEnd('/') &&
        first.username == second.username && first.password == second.password

private fun searchRow(stream: StreamEntity) = StreamSearchFtsEntity(
    contentKey = stream.key,
    providerId = stream.providerId,
    kind = stream.kind,
    searchable = ArabicSearchNormalizer.searchable(
        stream.name,
        stream.genre,
        stream.year,
        stream.plot,
        stream.releaseDate,
        stream.streamType
    )
)

private const val CATALOG_INSERT_BATCH_SIZE = 1000
private const val SEARCH_INSERT_BATCH_SIZE = 700
private const val SQLITE_BIND_BATCH_SIZE = 800
