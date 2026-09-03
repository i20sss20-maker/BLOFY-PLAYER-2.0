package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * Commercial-style stale-while-revalidate catalog engine.
 * Cached Room data is always used immediately by the UI while stale catalogs refresh in background.
 */
object BackgroundCatalogEngine {
    private const val PREFS = "blofy_background_catalog"
    private const val REFRESH_AFTER_MS = 6 * 60 * 60_000L
    private const val WARM_ART_LIMIT = 28
    private const val STARTUP_GRACE_MS = 1_500L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // Collections.newSetFromMap is available on API 23 and keeps the same concurrent set semantics.
    private val running: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    fun kick(context: Context) {
        val app = context.applicationContext
        scope.launch {
            delay(STARTUP_GRACE_MS)
            val dao = BlofyDatabase.get(app).dao()
            val provider = dao.providers().first().firstOrNull() ?: return@launch

            val warm = runCatching { dao.latestHomeStreams(provider.id, WARM_ART_LIMIT) }.getOrDefault(emptyList())
            if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(app, warm.map { it.icon ?: it.backdrop })

            if (!dao.hasCatalog(provider.id)) return@launch
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val key = "${provider.id}:last_refresh"
            val last = prefs.getLong(key, 0L)
            if (last > 0L && System.currentTimeMillis() - last < REFRESH_AFTER_MS) return@launch
            if (!running.add(provider.id)) return@launch

            try {
                val result = PlaylistSyncPolicy.run { PlaylistManager(XtreamClient.api, dao).syncAll(provider) }
                if (result.freshItemCount > 0 && result.failedSectionCount == 0) {
                    prefs.edit().putLong(key, System.currentTimeMillis()).apply()
                    val refreshedWarm = runCatching { dao.latestHomeStreams(provider.id, WARM_ART_LIMIT) }.getOrDefault(emptyList())
                    ArtworkLoader.warmPrefetch(app, refreshedWarm.map { it.icon ?: it.backdrop })
                }
            } catch (_: Throwable) {
                // Best effort only: stale cache remains the source of truth until a later retry succeeds.
            } finally {
                running.remove(provider.id)
            }
        }
    }
}
