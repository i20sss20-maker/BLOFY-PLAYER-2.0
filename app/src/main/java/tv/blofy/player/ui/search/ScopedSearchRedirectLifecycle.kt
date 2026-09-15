package tv.blofy.player.ui.search

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle

/**
 * Existing catalog entry points already pass SearchActivity.EXTRA_KIND. Keep the global Home search
 * unchanged, but route those scoped entry points into the dedicated section UI.
 */
class ScopedSearchRedirectLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity !is SearchActivity || activity.isFinishing) return
        val kind = activity.intent.getStringExtra(SearchActivity.EXTRA_KIND)?.lowercase().orEmpty()
        if (kind !in SCOPED_KINDS) return
        activity.startActivity(Intent(activity, SectionSearchActivity::class.java).apply {
            putExtra(SectionSearchActivity.EXTRA_KIND, kind)
        })
        activity.finish()
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    private companion object {
        val SCOPED_KINDS = setOf("live", "movie", "series")
    }
}
