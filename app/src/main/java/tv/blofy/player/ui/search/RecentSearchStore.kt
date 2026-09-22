package tv.blofy.player.ui.search

import android.content.Context

/** Small local-only search history. No provider credentials or URLs are ever stored here. */
object RecentSearchStore {
    private const val PREFS = "blofy_recent_searches_v1"
    private const val COUNT = "count"
    private const val ITEM_PREFIX = "item_"
    private const val MAX_ITEMS = 8

    fun recent(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val count = prefs.getInt(COUNT, 0).coerceIn(0, MAX_ITEMS)
        return (0 until count)
            .mapNotNull { prefs.getString(ITEM_PREFIX + it, null)?.trim()?.takeIf(String::isNotEmpty) }
            .distinctBy { it.lowercase() }
    }

    fun record(context: Context, query: String) {
        val clean = query.trim().replace(Regex("\\s+"), " ").take(120)
        if (clean.length < 2) return
        val items = buildList {
            add(clean)
            addAll(recent(context).filterNot { it.equals(clean, ignoreCase = true) })
        }.take(MAX_ITEMS)
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
        items.forEachIndexed { index, value -> editor.putString(ITEM_PREFIX + index, value) }
        editor.putInt(COUNT, items.size).apply()
    }

    /** Replace a backup's newest-first history in one preferences update. */
    internal fun replace(context: Context, queries: List<String>): Int {
        val items = queries.asSequence()
            .map { it.trim().replace(Regex("\\s+"), " ").take(120) }
            .filter { it.length >= 2 }
            .distinctBy { it.lowercase() }
            .take(MAX_ITEMS).toList()
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
        items.forEachIndexed { index, value -> editor.putString(ITEM_PREFIX + index, value) }
        editor.putInt(COUNT, items.size).apply()
        return items.size
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
