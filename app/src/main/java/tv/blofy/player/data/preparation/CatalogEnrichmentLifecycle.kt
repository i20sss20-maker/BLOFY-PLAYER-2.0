package tv.blofy.player.data.preparation

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity

/** Cached login paths bypass the loading Activity. They must also resume durable enrichment. */
class CatalogEnrichmentLifecycle : Application.ActivityLifecycleCallbacks {
    @Volatile private var lastStorageTrimAt = 0L

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        activity.lifecycleScope.launch {
            val app = activity.applicationContext
            val provider = withContext(Dispatchers.IO) {
                val now = System.currentTimeMillis()
                if (now - lastStorageTrimAt >= STORAGE_TRIM_INTERVAL_MS) {
                    runCatching { LocalStorageManager.trimTemporaryIfNeeded(app) }
                    lastStorageTrimAt = now
                }
                BlofyDatabase.get(app).dao().providers().first().firstOrNull()
                    ?.takeIf { CatalogSyncState.isEntryReady(app, it.id) }
            } ?: return@launch
            if (!activity.isFinishing && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                FullCatalogPreparer.resumeBackground(app, provider.id)
            }
        }
    }
    override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val STORAGE_TRIM_INTERVAL_MS = 6L * 60L * 60L * 1000L
    }
}
