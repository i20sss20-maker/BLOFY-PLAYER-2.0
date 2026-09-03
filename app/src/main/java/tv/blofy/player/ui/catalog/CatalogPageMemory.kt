package tv.blofy.player.ui.catalog

import tv.blofy.player.data.local.StreamEntity

/** Small bounded in-process cache so returning from details does not rebuild already loaded catalog pages. */
internal object CatalogPageMemory {
    data class Snapshot(
        val items: List<StreamEntity>,
        val total: Int,
        val lastRowId: Long,
        val focusedKey: String?,
        val savedAt: Long = System.currentTimeMillis()
    )

    private const val MAX_ITEMS_PER_SNAPSHOT = 3000
    private const val MAX_SNAPSHOTS = 4
    private const val MAX_AGE_MS = 10 * 60_000L
    private val entries = object : LinkedHashMap<String, Snapshot>(MAX_SNAPSHOTS, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Snapshot>?): Boolean = size > MAX_SNAPSHOTS
    }

    @Synchronized
    fun put(key: String, items: List<StreamEntity>, total: Int, lastRowId: Long, focusedKey: String?) {
        if (items.isEmpty() || items.size > MAX_ITEMS_PER_SNAPSHOT) return
        entries[key] = Snapshot(items.toList(), total, lastRowId, focusedKey)
    }

    @Synchronized
    fun get(key: String): Snapshot? {
        val value = entries[key] ?: return null
        if (System.currentTimeMillis() - value.savedAt > MAX_AGE_MS) {
            entries.remove(key)
            return null
        }
        return value
    }

    @Synchronized fun remove(key: String) { entries.remove(key) }
}
