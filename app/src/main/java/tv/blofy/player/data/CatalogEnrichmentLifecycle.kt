package tv.blofy.player.data

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.preparation.FullCatalogPreparer
import tv.blofy.player.ui.home.HomeActivity

/**
 * Restarts the bounded metadata/episode/artwork enrichment only after Home is already interactive.
 * FullCatalogPreparer owns deduplication and epoch guards, so repeated Home resumes are cheap and
 * never block remote input or first frame.
 */
class CatalogEnrichmentLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity || activity.isFinishing || activity.isDestroyed) return
        activity.lifecycleScope.launch {
            val providerId = withContext(Dispatchers.IO) {
                BlofyDatabase.get(activity.applicationContext).dao().providers().first().firstOrNull()?.id
            } ?: return@launch
            if (!CatalogSyncState.isEntryReady(activity.applicationContext, providerId)) return@launch
            FullCatalogPreparer.resumeBackground(activity.applicationContext, providerId)
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
