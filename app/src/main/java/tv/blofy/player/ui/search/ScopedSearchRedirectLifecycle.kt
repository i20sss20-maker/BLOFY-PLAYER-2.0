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
            // AI and other deep links arrive in SearchActivity with a real query.
            // Forward it when routing to a scoped screen; otherwise the next
            // activity opens with a blank search box and no matching results.
            forwardedQuery(activity.intent)?.let {
                putExtra(SectionSearchActivity.EXTRA_QUERY, it)
            }
        })
        activity.finish()
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private val SCOPED_KINDS = setOf("live", "movie", "series")

        /** Keep AI-selected search text when an older scoped entry point redirects. */
        internal fun forwardedQuery(intent: Intent): String? =
            intent.getStringExtra(SearchActivity.EXTRA_INITIAL_QUERY)
                ?.trim()?.take(120)?.takeIf(String::isNotBlank)
    }
}
