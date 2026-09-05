package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.SmartZappingInvalidator
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.catalog.ArtworkLoader

/**
 * Startup-safe local maintenance only. Opening BLOFY must never trigger a provider catalog refresh.
 * Network refresh is reserved for the explicit refresh flow or a changed/new playlist.
 */
object BackgroundCatalogEngine {
    private const val WARM_ART_LIMIT = 40
    private const val STARTUP_GRACE_MS = 1_500L
    private const val INDEX_PREFS = "blofy_search_index"
    private const val INDEX_V9_PREFIX = "v9_ready_"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun kick(context: Context) {
        val app = context.applicationContext
        CatalogRefreshWorker.cancelLegacyAutomatic(app)

        scope.launch {
            delay(STARTUP_GRACE_MS)
            val database = BlofyDatabase.get(app)
            val dao = database.dao()
            runCatching {
                database.openHelper.writableDatabase.execSQL("UPDATE streams SET locked = 0 WHERE locked != 0")
                SmartZappingInvalidator.install(database)
            }

            val provider = dao.providers().first().firstOrNull() ?: return@launch
            val prefs = app.getSharedPreferences(INDEX_PREFS, Context.MODE_PRIVATE)
            val indexKey = INDEX_V9_PREFIX + provider.id
            if (!prefs.getBoolean(indexKey, false) && dao.hasCatalog(provider.id)) {
                val rebuilt = runCatching {
                    dao.rebuildSearchIndex(provider.id)
                    true
                }.getOrDefault(false)
                if (rebuilt) prefs.edit().putBoolean(indexKey, true).apply()
            }

            val warm = runCatching { dao.latestHomeStreams(provider.id, WARM_ART_LIMIT) }
                .getOrDefault(emptyList())
            if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(app, warm.map { it.backdrop ?: it.icon })

            // Resume only missing enrichment from its persisted checkpoint. The core catalog is
            // never downloaded on startup and already-cached rows are reused.
            CatalogSyncState.resumeEnrichment(app, provider.id)
        }
    }
}
