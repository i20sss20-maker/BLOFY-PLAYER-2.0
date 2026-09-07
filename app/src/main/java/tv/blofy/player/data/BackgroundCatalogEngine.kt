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
            if (dao.hasCatalog(provider.id)) runCatching {
                CatalogSearchIndex.ensureReady(app, dao, provider.id)
            }

            val warm = runCatching { dao.latestHomeStreams(provider.id, WARM_ART_LIMIT) }
                .getOrDefault(emptyList())
            if (warm.isNotEmpty()) ArtworkLoader.warmPrefetch(app, warm.map { it.backdrop ?: it.icon })

        }
    }
}
