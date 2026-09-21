package tv.blofy.player.ui.settings

import android.content.Context
import androidx.room.withTransaction
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.ui.search.RecentSearchStore

object LocalBackupManager {
    private const val SCHEMA = 1

    private val allowedSettings = mapOf(
        RuntimeSettings.KEY_MOTION to setOf("smooth", "reduced"),
        RuntimeSettings.KEY_AUDIO_OUTPUT to setOf("auto", "stereo"),
        RuntimeSettings.KEY_SUBTITLE_LANGUAGE to setOf("ar", "auto", "off"),
        RuntimeSettings.KEY_SUBTITLE_SIZE to setOf("small", "medium", "large"),
        RuntimeSettings.KEY_ASPECT to setOf("fit", "zoom", "fill"),
        RuntimeSettings.KEY_AUTOPLAY_LIVE to setOf("on", "off"),
        RuntimeSettings.KEY_RESUME_PROMPT to setOf("on", "off"),
        RuntimeSettings.KEY_AUTO_NEXT to setOf("ask", "on", "off")
    )

    data class RestoreResult(
        val categories: Int,
        val flags: Int,
        val watchStates: Int,
        val settings: Int,
        val searches: Int
    )

    suspend fun exportJson(context: Context): String {
        val app = context.applicationContext
        val dao = BlofyDatabase.get(app).dao()
        val provider = dao.providersStored().first().firstOrNull() ?: error("no_active_provider")
        val root = JSONObject()
            .put("schema", SCHEMA)
            .put("createdAt", System.currentTimeMillis())
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("providerId", provider.id)
            .put("providerName", provider.name)

        val categories = JSONArray()
        dao.allCategoriesForProvider(provider.id).forEach { category ->
            categories.put(JSONObject()
                .put("kind", category.kind)
                .put("remoteId", category.remoteId)
                .put("orderIndex", category.orderIndex)
                .put("hidden", category.hidden))
        }
        root.put("categories", categories)

        val flags = JSONArray()
        listOf("live", "movie", "series").forEach { kind ->
            dao.persistedStreamFlags(provider.id, kind).forEach { stream ->
                flags.put(JSONObject()
                    .put("kind", stream.kind)
                    .put("remoteId", stream.remoteId)
                    .put("favorite", stream.favorite)
                    .put("locked", stream.locked))
            }
        }
        root.put("streamFlags", flags)

        val watch = JSONArray()
        dao.watchStates(provider.id).forEach { state ->
            watch.put(JSONObject()
                .put("contentKey", state.contentKey)
                .put("kind", state.kind)
                .put("positionMs", state.positionMs)
                .put("durationMs", state.durationMs)
                .put("completed", state.completed)
                .put("updatedAt", state.updatedAt))
        }
        root.put("watchStates", watch)

        val settings = JSONObject()
        val prefs = app.getSharedPreferences(RuntimeSettings.PREFS, Context.MODE_PRIVATE)
        allowedSettings.forEach { (key, allowedValues) ->
            val value = runCatching { prefs.getString(key, null) }.getOrNull()
            if (value != null && value in allowedValues) settings.put(key, value)
        }
        root.put("settings", settings)
        root.put("recentSearches", JSONArray(RecentSearchStore.recent(app)))
        return root.toString(2)
    }

    suspend fun restoreJson(context: Context, json: String): RestoreResult {
        val app = context.applicationContext
        require(json.length <= 8 * 1024 * 1024) { "backup_too_large" }
        val root = JSONObject(json)
        require(root.optInt("schema") == SCHEMA) { "unsupported_backup" }
        val database = BlofyDatabase.get(app)
        // Room rolls back categories, favorites/locks and history together on failure/cancellation.
        // Validate the active provider inside that transaction, before touching any saved row.
        val restored = database.withTransaction {
            val dao = database.dao()
            val provider = dao.activeProviderId()?.let { dao.providerStored(it) } ?: error("no_active_provider")
            require(root.optString("providerId") == provider.id) { "backup_different_server" }

            val currentCategories = dao.allCategoriesForProvider(provider.id)
                .associateBy { "${it.kind}\u0000${it.remoteId}" }
            val categoryUpdates = mutableListOf<tv.blofy.player.data.local.CategoryEntity>()
            val categoryJson = root.optJSONArray("categories") ?: JSONArray()
            for (index in 0 until categoryJson.length()) {
                val item = categoryJson.optJSONObject(index) ?: continue
                val key = "${item.optString("kind")}\u0000${item.optString("remoteId")}"
                val existing = currentCategories[key] ?: continue
                categoryUpdates += existing.copy(
                    orderIndex = item.optInt("orderIndex", existing.orderIndex),
                    hidden = item.optBoolean("hidden", existing.hidden)
                )
            }
            if (categoryUpdates.isNotEmpty()) dao.upsertCategories(categoryUpdates)

            var restoredFlags = 0
            val flags = root.optJSONArray("streamFlags") ?: JSONArray()
            for (index in 0 until flags.length()) {
                val item = flags.optJSONObject(index) ?: continue
                val kind = item.optString("kind")
                val remoteId = item.optString("remoteId")
                val stream = dao.streamByIdentity(provider.id, kind, remoteId) ?: continue
                dao.setFavoriteByIdentity(provider.id, kind, remoteId, item.optBoolean("favorite", stream.favorite))
                dao.setLocked(stream.key, item.optBoolean("locked", stream.locked))
                restoredFlags++
            }

            var restoredWatch = 0
            val watch = root.optJSONArray("watchStates") ?: JSONArray()
            for (index in 0 until watch.length()) {
                val item = watch.optJSONObject(index) ?: continue
                val contentKey = item.optString("contentKey").takeIf { it.startsWith(provider.id + ":") } ?: continue
                dao.saveWatchState(WatchStateEntity(
                    contentKey = contentKey,
                    providerId = provider.id,
                    kind = item.optString("kind"),
                    positionMs = item.optLong("positionMs").coerceAtLeast(0L),
                    durationMs = item.optLong("durationMs").coerceAtLeast(0L),
                    completed = item.optBoolean("completed", false),
                    updatedAt = item.optLong("updatedAt", System.currentTimeMillis())
                ))
                restoredWatch++
            }

            Triple(categoryUpdates.size, restoredFlags, restoredWatch)
        }

        var restoredSettings = 0
        val settings = root.optJSONObject("settings") ?: JSONObject()
        val editor = app.getSharedPreferences(RuntimeSettings.PREFS, Context.MODE_PRIVATE).edit()
        settings.keys().forEach { key ->
            val allowedValues = allowedSettings[key] ?: return@forEach
            val value = settings.opt(key) as? String ?: return@forEach
            if (value !in allowedValues) return@forEach
            editor.putString(key, value)
            restoredSettings++
        }
        editor.apply()

        // Older/partial backups without this optional field must not erase current history.
        val searches = root.optJSONArray("recentSearches")
        val searchItems = if (searches == null) null else buildList {
            for (index in 0 until searches.length()) (searches.opt(index) as? String)?.let(::add)
        }
        val restoredSearches = searchItems?.let { RecentSearchStore.replace(app, it) } ?: 0

        return RestoreResult(restored.first, restored.second, restored.third, restoredSettings, restoredSearches)
    }
}
