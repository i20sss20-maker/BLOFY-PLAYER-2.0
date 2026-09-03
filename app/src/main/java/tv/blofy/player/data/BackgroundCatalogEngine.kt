package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.catalog.ArtworkLoader

/**
 * Stale-while-revalidate entry point. UI always reads Room first; durable refresh work is delegated
 * to WorkManager so it survives process death and never blocks startup.
 */
object BackgroundCatalogEngine {
    private const val REFRESH_AFTER_MS = 6 * 60 * 60_000L
    private const val WARM_ART_LIMIT = 28
    private const val STARTUP_GRACE_MS = 1_500L
    private const val INDEX_PREFS = "blofy_search_index"
    private const val INDEX_V9_PREFIX = "v9_ready_"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun kick(context: Context) {
        val app = context.applicationContext
        CatalogRefreshWorker.schedule(app)
        scope.launch {
            delay(STARTUP_GRACE_MS)
            val dao = BlofyDatabase.get(app).dao()
            val provider = dao.providers().first().firstOrNull() ?: return@launch

            // RC06 -> RC07 upgrades create the FTS table instantly during migration. Backfill the
            // existing catalog only after UI startup. If the process dies midway the flag remains
            // false and the next launch retries safely; normal search keeps working via LIKE.
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
            if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(app, warm.map { it.icon ?: it.backdrop })

            if (!dao.hasCatalog(provider.id)) return@launch
            val last = CatalogSyncState.lastUpdatedAt(app, provider.id)
            if (last <= 0L || System.currentTimeMillis() - last >= REFRESH_AFTER_MS) {
                CatalogRefreshWorker.enqueueNow(app, provider.id)
            }
        }
    }
}
