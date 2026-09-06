package tv.blofy.player.data.preparation

import android.app.Activity
import android.app.Application
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

            // Let Home and remote focus become interactive before optional metadata/image work.
            // Low-memory boxes receive a longer quiet period to avoid a visible post-login stall.
            delay(if (DeviceClass.isLowMemory(app)) 4_000L else 1_200L)
            if (activity.isFinishing || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return@launch

            withContext(Dispatchers.IO) { LocalStorageManager.trimTemporaryIfNeeded(app) }
            if (!LocalStorageManager.hasHealthyFreeSpace(app)) return@launch

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
}
