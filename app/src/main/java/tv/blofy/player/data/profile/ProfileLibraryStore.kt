package tv.blofy.player.data.profile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.core.cloud.ProfileCloudAutoSync
import tv.blofy.player.core.profile.ProfileStore

/** Per-profile UX state. Content keys are provider-local and safe to recreate after sync. */
object ProfileLibraryStore {
    data class Snapshot(
        val watchlist: List<String>,
        val hiddenCategories: List<String>,
        val homeRows: List<String>,
        val settings: Map<String, Any>,
    )

    private const val PREFS = "blofy_profile_library_v1"
    private const val MAX_WATCHLIST = 500
    private const val MAX_HIDDEN_CATEGORIES = 500
    private const val MAX_SETTINGS = 80

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
        return writeAndSync(context, profileId) { writeSet(context, key(profileId, "watchlist"), next) }
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
        return writeAndSync(context, profileId) { writeSet(context, key(profileId, "hidden_categories"), next) }
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
        return writeAndSync(context, profileId) { writeList(context, key(profileId, "home_rows"), clean) }
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
        writeAndSync(context, profileId) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key(profileId, "home_rows")).commit()
        }

    /** Small profile-owned preferences that are safe to sync (never credentials/playback URLs). */
    fun settings(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Map<String, Any> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(profileId, "settings"), null)
            ?: return emptyMap()
        return runCatching {
            val json = JSONObject(raw)
            buildMap {
                val keys = json.keys()
                while (keys.hasNext() && size < MAX_SETTINGS) {
                    val name = keys.next()
                    if (!SETTING_KEY.matches(name)) continue
                    when (val value = json.opt(name)) {
                        is String -> put(name, value.take(256))
                        is Boolean -> put(name, value)
                        is Int -> put(name, value)
                        is Long -> put(name, value)
                        is Double -> put(name, value)
                    }
                }
            }
        }.getOrDefault(emptyMap())
    }

    fun setSetting(
        context: Context,
        name: String,
        value: Any?,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean {
        if (!SETTING_KEY.matches(name)) return false
        val next = LinkedHashMap(settings(context, profileId))
        if (value == null) next.remove(name) else when (value) {
            is String -> next[name] = value.take(256)
            is Boolean, is Int, is Long, is Double -> next[name] = value
            else -> return false
        }
        val json = JSONObject()
        next.entries.take(MAX_SETTINGS).forEach { (k, v) -> json.put(k, v) }
        return writeAndSync(context, profileId) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(key(profileId, "settings"), json.toString()).commit()
        }
    }

    fun booleanSetting(
        context: Context,
        name: String,
        default: Boolean,
        profileId: String = ProfileStore.storageNamespace(context),
    ): Boolean = settings(context, profileId)[name] as? Boolean ?: default

    fun snapshot(context: Context, profileId: String = ProfileStore.storageNamespace(context)): Snapshot = Snapshot(
        watchlist = watchlist(context, profileId).toList().takeLast(MAX_WATCHLIST),
        hiddenCategories = hiddenCategories(context, profileId).toList().take(MAX_HIDDEN_CATEGORIES),
        homeRows = homeRows(context, profileId).filter { it in ALL_HOME_ROWS }.distinct().take(20),
        settings = settings(context, profileId),
    )

    fun snapshotJson(context: Context, profileId: String = ProfileStore.storageNamespace(context)): JSONObject {
        val value = snapshot(context, profileId)
        return JSONObject().apply {
            put("watchlist", JSONArray(value.watchlist))
            put("hiddenCategories", JSONArray(value.hiddenCategories))
            put("homeRows", JSONArray(value.homeRows))
            put("settings", JSONObject(value.settings))
        }
    }

    fun restoreSnapshot(context: Context, profileId: String, payload: JSONObject): Boolean {
        if (profileId.isBlank()) return false
        val watchlistValues = payload.optJSONArray("watchlist").asStringList(MAX_WATCHLIST)
        val hiddenValues = payload.optJSONArray("hiddenCategories").asStringList(MAX_HIDDEN_CATEGORIES)
        val rowValues = payload.optJSONArray("homeRows").asStringList(20)
            .filter { it in ALL_HOME_ROWS }
            .distinct()
        val settingsJson = sanitizeSettings(payload.optJSONObject("settings"))
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit()
            .putString(key(profileId, "watchlist"), JSONArray(watchlistValues).toString())
            .putString(key(profileId, "hidden_categories"), JSONArray(hiddenValues).toString())
            .putString(key(profileId, "settings"), settingsJson.toString())
        if (rowValues.isEmpty()) editor.remove(key(profileId, "home_rows"))
        else editor.putString(key(profileId, "home_rows"), JSONArray(rowValues).toString())
        return editor.commit()
    }

    fun clearProfile(context: Context, profileId: String) {
        ProfileCloudAutoSync.cancel(profileId)
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        listOf("watchlist", "hidden_categories", "home_rows", "settings").forEach { editor.remove(key(profileId, it)) }
        editor.apply()
    }

    private fun writeAndSync(context: Context, profileId: String, write: () -> Boolean): Boolean {
        val saved = write()
        if (saved) ProfileCloudAutoSync.schedule(context, profileId)
        return saved
    }

    private fun sanitizeSettings(source: JSONObject?): JSONObject {
        val result = JSONObject()
        if (source == null) return result
        val keys = source.keys()
        var count = 0
        while (keys.hasNext() && count < MAX_SETTINGS) {
            val name = keys.next()
            if (!SETTING_KEY.matches(name)) continue
            when (val value = source.opt(name)) {
                is String -> result.put(name, value.take(256))
                is Boolean -> result.put(name, value)
                is Int -> result.put(name, value)
                is Long -> result.put(name, value)
                is Double -> result.put(name, value)
                else -> continue
            }
            count++
        }
        return result
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
    private val SETTING_KEY = Regex("[A-Za-z0-9._-]{1,64}")
}
