package tv.blofy.player.core.identity

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.login.StartupEntryState
import tv.blofy.player.ui.player.PlayerActivity

/** Recheck a displayed library/player without owning Login or doing catalog maintenance. */
class ActivationLeaseLifecycle : Application.ActivityLifecycleCallbacks {
    private var current: Activity? = null
    private var job: Job? = null
    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity && activity !is PlayerActivity) return
        activity as AppCompatActivity
        current = activity
        job?.cancel()
        job = activity.lifecycleScope.launch {
            delay(10_000L)
            while (isActive && current === activity) {
                val allowed = try { withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(activity.applicationContext).dao()
                    val cached = dao.activation() ?: return@withContext false
                    val manager = ActivationManager(activity.applicationContext, dao)
                    try {
                        manager.refresh(ActivationRemoteClient.create(BuildConfig.ACTIVATION_BASE_URL), BuildConfig.VERSION_NAME).canUse()
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        if (error is HttpException && error.code() == 403) {
                            manager.applyRemoteStatus(false, cached.expiresAt)
                            false
                        } else manager.cachedCanUse(dao.activation() ?: cached)
                    }
                } } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { false } // A local storage failure must not crash the foreground activity or grant a lease.
                if (!allowed && current === activity && !activity.isFinishing && !activity.isDestroyed) {
                    // Do not let the next cold start jump back into Home after a blocked/expired
                    // lease. Splash reads this hint synchronously and will return to Login instead.
                    StartupEntryState.clear(activity.applicationContext)
                    activity.startActivity(Intent(activity, LoginActivity::class.java).addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    return@launch
                }
                delay(5L * 60L * 1000L)
            }
        }
    }
    override fun onActivityPaused(activity: Activity) { if (current === activity) { current = null; job?.cancel(); job = null } }
    override fun onActivityDestroyed(activity: Activity) = onActivityPaused(activity)
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
}
