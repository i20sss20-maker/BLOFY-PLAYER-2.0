package tv.blofy.player.data.profile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.core.profile.ProfileStore

/** Per-profile UX state. Content keys are provider-local and safe to recreate after sync. */
object ProfileLibraryStore {
    data class Snapshot(
        val watchlist: List<String>,
        val hiddenCategories: List<String>,
        val homeRows: List<String>,
    )

    private const val PREFS = "blofy_profile_library_v1"
    private const val MAX_WATCHLIST = 500
    private const val MAX_HIDDEN_CATEGORIES = 500

    fun watchlist(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Set<String> =
        readSet(context, key(profileId, "watchlist"))

    fun isWatchlisted(context: Context, contentKey: String, profileId: String = ProfileStore.storageNamespace(context)): Boolean =
        contentKey.isNotBlank() && watchlist(context, profileId).contains(contentKey)

    fun setWatchlisted(
        context: Context,
        contentKey: String,
        enabled: Boolean,
        profileId: String = ProfileStore.storageNamespace(context),
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

    fun hiddenCategories(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Set<String> =
        readSet(context, key(profileId, "hidden_categories"))

    fun setCategoryHidden(
        context: Context,
        categoryKey: String,
        hidden: Boolean,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean {
        if (categoryKey.isBlank()) return false
        val next = LinkedHashSet(hiddenCategories(context, profileId))
        if (hidden) {
            next.add(categoryKey)
            while (next.size > MAX_HIDDEN_CATEGORIES) next.remove(next.first())
        } else next.remove(categoryKey)
        return writeSet(context, key(profileId, "hidden_categories"), next)
    }

    fun homeRows(context: Context, profileId: String = ProfileStore.storageNamespace(context)): List<String> {
        val saved = readList(context, key(profileId, "home_rows"))
        return saved.ifEmpty { DEFAULT_HOME_ROWS }
    }

    fun saveHomeRows(
        context: Context,
        rows: List<String>,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean {
        val clean = rows.asSequence()
            .map(String::trim)
            .filter { it in ALL_HOME_ROWS }
            .distinct()
            .take(20)
            .toList()
        return writeList(context, key(profileId, "home_rows"), clean)
    }

    fun setHomeRowEnabled(
        context: Context,
        row: String,
        enabled: Boolean,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean {
        if (row !in ALL_HOME_ROWS) return false
        val next = homeRows(context, profileId).toMutableList()
        next.remove(row)
        if (enabled) next.add(row)
        return saveHomeRows(context, next, profileId)
    }

    fun moveHomeRow(
        context: Context,
        row: String,
        delta: Int,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean {
        val next = homeRows(context, profileId).toMutableList()
        val from = next.indexOf(row)
        if (from < 0) return false
        val to = (from + delta).coerceIn(0, next.lastIndex)
        if (from == to) return true
        next.removeAt(from)
        next.add(to, row)
        return saveHomeRows(context, next, profileId)
    }

    fun resetHomeRows(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key(profileId, "home_rows")).commit()

    fun snapshot(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Snapshot = Snapshot(
        watchlist = watchlist(context, profileId).toList().takeLast(MAX_WATCHLIST),
        hiddenCategories = hiddenCategories(context, profileId).toList().take(MAX_HIDDEN_CATEGORIES),
        homeRows = homeRows(context, profileId).filter { it in ALL_HOME_ROWS }.distinct().take(20),
    )

    fun snapshotJson(context: Context, profileId: String = ProfileStore.storageNamespace(context)): JSONObject {
        val value = snapshot(context, profileId)
        return JSONObject().apply {
            put("watchlist", JSONArray(value.watchlist))
            put("hiddenCategories", JSONArray(value.hiddenCategories))
            put("homeRows", JSONArray(value.homeRows))
        }
    }

    fun restoreSnapshot(context: Context, profileId: String, payload: JSONObject): Boolean {
        if (profileId.isBlank()) return false
        val watchlistValues = payload.optJSONArray("watchlist").asStringList(MAX_WATCHLIST)
        val hiddenValues = payload.optJSONArray("hiddenCategories").asStringList(MAX_HIDDEN_CATEGORIES)
        val rowValues = payload.optJSONArray("homeRows").asStringList(20)
            .filter { it in ALL_HOME_ROWS }
            .distinct()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit()
            .putString(key(profileId, "watchlist"), JSONArray(watchlistValues).toString())
            .putString(key(profileId, "hidden_categories"), JSONArray(hiddenValues).toString())
        if (rowValues.isEmpty()) editor.remove(key(profileId, "home_rows"))
        else editor.putString(key(profileId, "home_rows"), JSONArray(rowValues).toString())
        return editor.commit()
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

    private fun JSONArray?.asStringList(limit: Int): List<String> {
        if (this == null) return emptyList()
        return buildList {
            for (i in 0 until length()) {
                optString(i).trim().takeIf(String::isNotBlank)?.let(::add)
                if (size >= limit) break
            }
        }.distinct()
    }

    val ALL_HOME_ROWS = listOf(
        "continue_watching",
        "recent_channels",
        "watchlist",
        "latest",
        "top_rated",
        "arabic",
        "uhd",
    )

    val DEFAULT_HOME_ROWS = ALL_HOME_ROWS
}
