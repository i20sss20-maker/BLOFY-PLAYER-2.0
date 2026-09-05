package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase

/** Builds stable local Home/manifest state once the one-time provider preload is complete. */
object CatalogPostSyncFinalizer {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun maybeFinalize(context: Context, providerId: String) {
        val app = context.applicationContext
        if (!CatalogSyncState.isFullyReady(app, providerId)) return
        scope.launch {
            val dao = BlofyDatabase.get(app).dao()
            val provider = dao.provider(providerId) ?: dao.providers().first().firstOrNull { it.id == providerId } ?: return@launch
            runCatching { HomeSnapshotStore.rebuild(app, dao, provider) }
            runCatching { CatalogManifestStore.rebuild(app, dao, provider) }
        }
    }
}
