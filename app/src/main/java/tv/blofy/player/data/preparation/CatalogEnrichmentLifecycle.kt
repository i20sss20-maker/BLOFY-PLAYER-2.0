package tv.blofy.player.data.preparation

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.LocalStorageManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity

/** Cached login paths bypass the loading Activity. They must also resume durable enrichment. */
class CatalogEnrichmentLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        activity.lifecycleScope.launch {
            val app = activity.applicationContext
            val provider = withContext(Dispatchers.IO) {
                BlofyDatabase.get(app).dao().providers().first().firstOrNull()
                    ?.takeIf { CatalogSyncState.isEntryReady(app, it.id) }
            } ?: return@launch

            // Let Home and remote focus become interactive before optional local-cache/enrichment work.
            // Low-memory boxes receive a longer quiet period to avoid a visible post-login stall.
            delay(if (DeviceClass.isLowMemory(app)) 4_000L else 1_200L)
            if (activity.isFinishing || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@launch

            withContext(Dispatchers.IO) {
                val prefs = app.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE)
                val now = System.currentTimeMillis()
                val lastTrim = prefs.getLong(KEY_LAST_TRIM_AT, 0L)
                val urgent = !LocalStorageManager.hasHealthyFreeSpace(app)
                if (urgent || now - lastTrim >= STORAGE_TRIM_INTERVAL_MS) {
                    runCatching { LocalStorageManager.trimTemporaryIfNeeded(app) }
                    prefs.edit().putLong(KEY_LAST_TRIM_AT, now).apply()
                }
            }
            if (!LocalStorageManager.hasHealthyFreeSpace(app)) return@launch

            if (!activity.isFinishing && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                // Process death may happen after the durable Room catalog commit but before Home/
                // manifest readiness markers are written. Rebuild those accelerators quietly after
                // entry; failure here must never evict or hide the working local library.
                if (!CatalogSyncState.isEntryCachesReady(app, provider.id)) {
                    runCatching { FullCatalogPreparer.prepare(app, provider.id) { } }
                }
                if (!activity.isFinishing && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    FullCatalogPreparer.resumeBackground(app, provider.id)
                }
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
        private const val STORAGE_PREFS = "blofy_storage_maintenance_v1"
        private const val KEY_LAST_TRIM_AT = "last_trim_at"
        private const val STORAGE_TRIM_INTERVAL_MS = 6L * 60L * 60L * 1000L
    }
}
