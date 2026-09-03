package tv.blofy.player.core.playback

import kotlinx.coroutines.flow.first
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.StreamEntity

/**
 * Single entry point for fast live navigation.
 * First lookup warms the category from Room; subsequent lookups are in-memory.
 */
class SmartZappingCoordinator(private val dao: BlofyDao) {
    suspend fun warm(providerId: String, categoryId: String?) {
        if (providerId.isBlank() || SmartZappingCache.isFresh(providerId, categoryId)) return
        val items = dao.streams(providerId, "live", categoryId).first()
        SmartZappingCache.put(providerId, categoryId, items)
    }

    suspend fun adjacent(
        providerId: String,
        categoryId: String?,
        currentRemoteId: String,
        delta: Int
    ): StreamEntity? {
        SmartZappingCache.adjacent(providerId, categoryId, currentRemoteId, delta)?.let { return it }
        warm(providerId, categoryId)
        return SmartZappingCache.adjacent(providerId, categoryId, currentRemoteId, delta)
    }

    suspend fun channelNumber(providerId: String, categoryId: String?, number: Int): StreamEntity? {
        SmartZappingCache.byNumber(providerId, categoryId, number)?.let { return it }
        warm(providerId, categoryId)
        return SmartZappingCache.byNumber(providerId, categoryId, number)
    }

    suspend fun window(providerId: String, categoryId: String?, currentRemoteId: String): SmartZappingCache.Window {
        if (!SmartZappingCache.isFresh(providerId, categoryId)) warm(providerId, categoryId)
        return SmartZappingCache.window(providerId, categoryId, currentRemoteId)
    }
}
