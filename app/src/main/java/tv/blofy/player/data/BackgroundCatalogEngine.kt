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
    private const val STARTUP_GRACE_MS = 1_200L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun kick(context: Context) {
        val app = context.applicationContext
        CatalogRefreshWorker.schedule(app)
        scope.launch {
            delay(STARTUP_GRACE_MS)
            val dao = BlofyDatabase.get(app).dao()
            val provider = dao.providers().first().firstOrNull() ?: return@launch
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
