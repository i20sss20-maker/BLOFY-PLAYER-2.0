package tv.blofy.player.data

import android.app.Activity
import android.app.Application
import android.os.Bundle
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.player.VlcFallbackActivity

/** Tracks active playback without altering the playback engine or the video Activity. */
internal class CatalogPlaybackLifecycle : Application.ActivityLifecycleCallbacks {
    private fun isPlaybackScreen(activity: Activity): Boolean =
        activity is PlayerActivity || activity is VlcFallbackActivity
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) {
        if (isPlaybackScreen(activity)) CatalogPlaybackGate.playerStarted()
    }
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) {
        if (isPlaybackScreen(activity)) CatalogPlaybackGate.playerStopped()
    }
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
