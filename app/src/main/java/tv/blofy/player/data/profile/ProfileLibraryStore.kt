package tv.blofy.player.data.profile

import android.content.Context
import org.json.JSONArray

/** Per-profile UX state. Content keys are provider-local and safe to recreate after sync. */
object ProfileLibraryStore {
    private const val PREFS = "blofy_profile_library_v1"
    private const val MAX_WATCHLIST = 500
    private const val MAX_HIDDEN_CATEGORIES = 500

    fun watchlist(context: Context, profileId: String = BlofyProfileStore.storageNamespace(context)): Set<String> =
        readSet(context, key(profileId, "watchlist"))

    fun setWatchlisted(
        context: Context,
        contentKey: String,
        enabled: Boolean,
        profileId: String = BlofyProfileStore.storageNamespace(context),
    ): Boolean {
        if (contentKey.isBlank()) return false
        val next = LinkedHashSet(watchlist(context, profileId))
        if (enabled) {
            next.remove(contentKey)
            next.add(contentKey)
            while (next.size > MAX_WATCHLIST) next.remove(next.first())
        } else next.remove(contentKey)
        return writeSet(context, key(profileId, "watchlist"), next)
    }

    fun hiddenCategories(context: Context, profileId: String = BlofyProfileStore.storageNamespace(context)): Set<String> =
        readSet(context, key(profileId, "hidden_categories"))

    fun setCategoryHidden(
        context: Context,
        categoryKey: String,
        hidden: Boolean,
        profileId: String = BlofyProfileStore.storageNamespace(context),
    ): Boolean {
        if (categoryKey.isBlank()) return false
        val next = LinkedHashSet(hiddenCategories(context, profileId))
        if (hidden) {
            next.add(categoryKey)
            while (next.size > MAX_HIDDEN_CATEGORIES) next.remove(next.first())
        } else next.remove(categoryKey)
        return writeSet(context, key(profileId, "hidden_categories"), next)
    }

    fun homeRows(context: Context, profileId: String = BlofyProfileStore.storageNamespace(context)): List<String> {
        val saved = readList(context, key(profileId, "home_rows"))
        return saved.ifEmpty { DEFAULT_HOME_ROWS }
    }

    fun saveHomeRows(
        context: Context,
        rows: List<String>,
        profileId: String = BlofyProfileStore.storageNamespace(context),
    ): Boolean {
        val clean = rows.asSequence().map(String::trim).filter(String::isNotBlank).distinct().take(20).toList()
        return writeList(context, key(profileId, "home_rows"), clean)
    }

    fun clearProfile(context: Context, profileId: String) {
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        listOf("watchlist", "hidden_categories", "home_rows").forEach { editor.remove(key(profileId, it)) }
        editor.apply()
    }

    private fun key(profileId: String, suffix: String) = "$profileId:$suffix"

    private fun readSet(context: Context, key: String): Set<String> = LinkedHashSet(readList(context, key))

    private fun readList(context: Context, key: String): List<String> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) array.optString(i).takeIf(String::isNotBlank)?.let(::add)
            }
        }.getOrDefault(emptyList())
    }

    private fun writeSet(context: Context, key: String, values: Set<String>) = writeList(context, key, values.toList())

    private fun writeList(context: Context, key: String, values: List<String>): Boolean {
        val array = JSONArray()
        values.forEach(array::put)
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, array.toString()).commit()
    }

    val DEFAULT_HOME_ROWS = listOf(
        "continue_watching",
        "recent_channels",
        "watchlist",
        "latest",
        "top_rated",
        "arabic",
        "uhd",
    )
}
