package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.blofy.player.core.cloud.ProfileCloudSync
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.library.ProfileWatchlistActivity
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Opportunistic BLOFY Cloud sync. Home remains local-first: cloud work is deferred until the screen
 * has been interactive for a while, so launch/catalog/artwork/DPAD are not competing with profile IO.
 */
class ProfileCloudLifecycle : Application.ActivityLifecycleCallbacks {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)
    @Volatile private var lastAttemptAt = 0L

    override fun onActivityResumed(activity: Activity) {
        when (activity) {
            is HomeActivity -> activity.lifecycleScope.launch {
                delay(HOME_DEFER_MS)
                // lifecycleScope survives pause. Do not let a delayed Home task wake up while the
                // user is already inside Player/details and compete with playback/network work.
                if (!activity.isFinishing && !activity.isDestroyed &&
                    activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    schedule(activity, force = false)
                }
            }
            is ProfilesActivity, is ProfileWatchlistActivity, is HomePersonalizationActivity ->
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

    companion object {
        private const val NORMAL_INTERVAL_MS = 90_000L
        private const val HOME_DEFER_MS = 10_000L
    }
}
