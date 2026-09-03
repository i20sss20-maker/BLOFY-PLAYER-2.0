package tv.blofy.player.core.playback

import tv.blofy.player.data.local.StreamEntity
import java.util.concurrent.ConcurrentHashMap

/**
 * In-memory live channel window used by PlayerActivity.
 * It never opens a second playback session; it only removes repeated Room reads
 * and keeps previous/current/next channel lookup O(1) while zapping.
 */
object SmartZappingCache {
    data class Key(val providerId: String, val categoryId: String?)

    data class Window(
        val previous: StreamEntity?,
        val current: StreamEntity?,
        val next: StreamEntity?
    )

    data class Position(
        val number: Int,
        val total: Int
    )

    private data class Entry(
        val items: List<StreamEntity>,
        val indexByRemoteId: Map<String, Int>,
        val createdAtMs: Long
    )

    private val entries = ConcurrentHashMap<Key, Entry>()
    private const val TTL_MS = 10 * 60 * 1000L

    fun put(providerId: String, categoryId: String?, items: List<StreamEntity>) {
        if (providerId.isBlank() || items.isEmpty()) return
        val stable = items.toList()
        entries[Key(providerId, categoryId)] = Entry(
            items = stable,
            indexByRemoteId = stable.mapIndexed { index, item -> item.remoteId to index }.toMap(),
            createdAtMs = System.currentTimeMillis()
        )
    }

    fun isFresh(providerId: String, categoryId: String?): Boolean {
        val entry = entries[Key(providerId, categoryId)] ?: return false
        return System.currentTimeMillis() - entry.createdAtMs <= TTL_MS
    }

    fun adjacent(
        providerId: String,
        categoryId: String?,
        currentRemoteId: String,
        delta: Int
    ): StreamEntity? {
        val entry = freshEntry(providerId, categoryId) ?: return null
        if (entry.items.isEmpty()) return null
        val current = entry.indexByRemoteId[currentRemoteId] ?: 0
        val target = Math.floorMod(current + delta, entry.items.size)
        return entry.items[target]
    }

    fun byNumber(providerId: String, categoryId: String?, number: Int): StreamEntity? {
        if (number <= 0) return null
        return freshEntry(providerId, categoryId)?.items?.getOrNull(number - 1)
    }

    fun position(
        providerId: String,
        categoryId: String?,
        currentRemoteId: String
    ): Position? {
        val entry = freshEntry(providerId, categoryId) ?: return null
        val index = entry.indexByRemoteId[currentRemoteId] ?: return null
        return Position(number = index + 1, total = entry.items.size)
    }

    fun window(providerId: String, categoryId: String?, currentRemoteId: String): Window {
        val entry = freshEntry(providerId, categoryId) ?: return Window(null, null, null)
        if (entry.items.isEmpty()) return Window(null, null, null)
        val index = entry.indexByRemoteId[currentRemoteId] ?: 0
        val previous = entry.items[Math.floorMod(index - 1, entry.items.size)]
        val current = entry.items[index]
        val next = entry.items[Math.floorMod(index + 1, entry.items.size)]
        return Window(previous, current, next)
    }

    fun invalidate(providerId: String) {
        entries.keys.removeAll { it.providerId == providerId }
    }

    fun clear() = entries.clear()

    private fun freshEntry(providerId: String, categoryId: String?): Entry? {
        val key = Key(providerId, categoryId)
        val entry = entries[key] ?: return null
        if (System.currentTimeMillis() - entry.createdAtMs > TTL_MS) {
            entries.remove(key)
            return null
        }
        return entry
    }
}
