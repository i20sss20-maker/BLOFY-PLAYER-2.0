package tv.blofy.player.data

import kotlinx.coroutines.flow.Flow
import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity

class ContentRepository(private val dao: BlofyDao) {
    fun categories(providerId: String, kind: String): Flow<List<CategoryEntity>> =
        dao.categories(providerId, kind)

    fun streams(providerId: String, kind: String, categoryId: String? = null): Flow<List<StreamEntity>> =
        dao.streams(providerId, kind, categoryId)

    fun episodes(providerId: String, seriesId: String): Flow<List<EpisodeEntity>> =
        dao.episodes(providerId, seriesId)

    fun favorites(providerId: String): Flow<List<StreamEntity>> = dao.favorites(providerId)

    fun continueWatching(providerId: String): Flow<List<WatchStateEntity>> = dao.continueWatching(providerId)

    fun epg(providerId: String, streamId: String, nowMs: Long = System.currentTimeMillis()): Flow<List<EpgEntity>> =
        dao.epg(providerId, streamId, nowMs)

    suspend fun search(providerId: String, query: String): List<StreamEntity> {
        val trimmed = query.trim()
        if (trimmed.isBlank()) return emptyList()
        val fts = ArabicSearchNormalizer.ftsQuery(trimmed)
        if (fts.isNotBlank()) {
            val indexed = runCatching { dao.searchStreamsFts(providerId, fts, 100) }.getOrDefault(emptyList())
            if (indexed.isNotEmpty()) return indexed
        }
        // Compatibility fallback for a database that is still completing a migration/rebuild.
        return dao.searchStreams(providerId, trimmed, 80)
    }

    /**
     * Fast local search scoped to one catalog kind. Use the FTS index first so a single character
     * can return prefix matches without loading the whole catalog into memory. A bounded SQL
     * fallback fills a section when the FTS index is still being rebuilt after an upgrade/refresh.
     */
    suspend fun searchKind(
        providerId: String,
        kind: String,
        query: String,
        limit: Int = 120
    ): List<StreamEntity> {
        val trimmed = query.trim()
        if (trimmed.isBlank() || kind !in SEARCH_KINDS || limit <= 0) return emptyList()

        val fts = ArabicSearchNormalizer.ftsQuery(trimmed)
        val indexed = if (fts.isNotBlank()) {
            runCatching {
                dao.searchStreamsFtsByKind(providerId, kind, fts, limit)
                    .asSequence()
                    .distinctBy { it.key }
                    .take(limit)
                    .toList()
            }.getOrDefault(emptyList())
        } else emptyList()

        // When FTS already supplied a healthy page, avoid the slower LIKE scan entirely.
        if (indexed.size >= minOf(limit, 24)) return indexed

        val fallback = dao.searchCatalog(providerId, kind, trimmed, limit)
        return (indexed.asSequence() + fallback.asSequence())
            .distinctBy { it.key }
            .take(limit)
            .toList()
    }

    suspend fun setFavorite(contentKey: String, favorite: Boolean) = dao.setFavorite(contentKey, favorite)

    suspend fun setLocked(contentKey: String, locked: Boolean) = dao.setLocked(contentKey, locked)

    suspend fun saveResume(contentKey: String, providerId: String, kind: String, positionMs: Long, durationMs: Long) {
        dao.saveWatchState(
            WatchStateEntity(
                contentKey = contentKey,
                providerId = providerId,
                kind = kind,
                positionMs = positionMs.coerceAtLeast(0L),
                durationMs = durationMs.coerceAtLeast(0L),
                completed = durationMs > 0L && positionMs >= durationMs - 30_000L
            )
        )
    }

    private companion object {
        val SEARCH_KINDS = setOf("live", "series", "movie")
    }
}
