package tv.blofy.player.data

import kotlinx.coroutines.flow.Flow
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

    /**
     * Global search stays bounded even on very large providers. Movies and series use the richer
     * catalog query (name + genre + year); live remains name based. Exact/prefix title matches are
     * ranked ahead of partial metadata matches so remote-control search feels deterministic.
     */
    suspend fun search(providerId: String, query: String): List<StreamEntity> {
        val needle = query.trim()
        if (needle.isBlank()) return emptyList()

        val movies = dao.searchCatalog(providerId, "movie", needle, SEARCH_PER_KIND_LIMIT)
        val series = dao.searchCatalog(providerId, "series", needle, SEARCH_PER_KIND_LIMIT)
        val live = dao.searchCatalog(providerId, "live", needle, SEARCH_PER_KIND_LIMIT)

        return (movies + series + live)
            .distinctBy { it.key }
            .sortedWith(
                compareBy<StreamEntity> { relevance(it, needle) }
                    .thenBy { kindOrder(it.kind) }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
            )
            .take(SEARCH_TOTAL_LIMIT)
    }

    private fun relevance(item: StreamEntity, query: String): Int {
        val name = item.name.trim()
        return when {
            name.equals(query, ignoreCase = true) -> 0
            name.startsWith(query, ignoreCase = true) -> 1
            name.contains(query, ignoreCase = true) -> 2
            item.year?.contains(query, ignoreCase = true) == true -> 3
            item.genre?.contains(query, ignoreCase = true) == true -> 4
            else -> 5
        }
    }

    private fun kindOrder(kind: String): Int = when (kind) {
        "movie" -> 0
        "series" -> 1
        "live" -> 2
        else -> 3
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
        const val SEARCH_PER_KIND_LIMIT = 120
        const val SEARCH_TOTAL_LIMIT = 180
    }
}
