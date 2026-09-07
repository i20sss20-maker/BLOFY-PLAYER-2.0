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

    private const val MAX_AGE_MS = 10 * 60_000L
    private val lowMemoryDevice: Boolean
        get() = Runtime.getRuntime().maxMemory() <= 256L * 1024L * 1024L
    private val maxItemsPerSnapshot: Int
        get() = if (lowMemoryDevice) 900 else 1800
    private val maxSnapshots: Int
        get() = if (lowMemoryDevice) 2 else 4

    private val entries = object : LinkedHashMap<String, Snapshot>(4, .75f, true) {}

    @Synchronized
    fun put(key: String, items: List<StreamEntity>, total: Int, lastRowId: Long, focusedKey: String?) {
        if (items.isEmpty() || items.size > maxItemsPerSnapshot) return
        entries[key] = Snapshot(items.toList(), total, lastRowId, focusedKey)
        trimToLimit()
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

    @Synchronized
    fun remove(key: String) { entries.remove(key) }

    @Synchronized
    fun clear() { entries.clear() }

    @Synchronized
    fun trimForMemoryPressure() {
        if (entries.size <= 1) return
        val newest = entries.entries.lastOrNull()?.let { it.key to it.value }
        entries.clear()
        newest?.let { entries[it.first] = it.second }
    }

    private fun trimToLimit() {
        while (entries.size > maxSnapshots) {
            val eldest = entries.entries.firstOrNull()?.key ?: break
            entries.remove(eldest)
        }
    }
}
