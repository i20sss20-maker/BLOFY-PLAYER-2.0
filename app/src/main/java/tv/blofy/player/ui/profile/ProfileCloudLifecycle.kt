package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.os.Bundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tv.blofy.player.core.cloud.ProfileCloudSync
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.library.ProfileWatchlistActivity
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Opportunistic BLOFY Cloud sync. It never blocks Activity startup and never opens playback state.
 */
class ProfileCloudLifecycle : Application.ActivityLifecycleCallbacks {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)
    @Volatile private var lastAttemptAt = 0L

    override fun onActivityResumed(activity: Activity) {
        if (activity is HomeActivity || activity is ProfilesActivity || activity is ProfileWatchlistActivity || activity is HomePersonalizationActivity) {
            schedule(activity, force = false)
        }
    }

    override fun onActivityStopped(activity: Activity) {
        if (activity is MovieDetailsActivity || activity is SeriesDetailsActivity || activity is ProfileWatchlistActivity || activity is HomePersonalizationActivity) {
            schedule(activity, force = true)
        }
    }

    private fun schedule(activity: Activity, force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - lastAttemptAt < NORMAL_INTERVAL_MS) return
        if (!running.compareAndSet(false, true)) return
        lastAttemptAt = now
        val appContext = activity.applicationContext
        scope.launch {
            try {
                runCatching { ProfileCloudSync.syncActive(appContext) }
            } finally {
                running.set(false)
            }
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object { private const val NORMAL_INTERVAL_MS = 90_000L }
}
