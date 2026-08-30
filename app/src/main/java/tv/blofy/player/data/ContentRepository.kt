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

    suspend fun search(providerId: String, query: String): List<StreamEntity> =
        if (query.isBlank()) emptyList() else dao.searchStreams(providerId, query.trim())

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
}
