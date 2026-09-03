package tv.blofy.player.core.personalization

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

/** Local-only lightweight personalization. No signal leaves the device. */
class UsageSignals : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
        val kind = when (activity) {
            is MovieDetailsActivity -> "movie"
            is SeriesDetailsActivity -> "series"
            is PosterCatalogActivity -> activity.intent.getStringExtra(PosterCatalogActivity.EXTRA_KIND)
            is ContentBrowserActivity -> activity.intent.getStringExtra(ContentBrowserActivity.EXTRA_KIND)
            is PlayerActivity -> activity.intent.getStringExtra(PlayerActivity.EXTRA_KIND)
            else -> null
        } ?: return
        if (kind !in setOf("live", "movie", "series", "episode")) return
        record(activity, if (kind == "episode") "series" else kind)
    }

    private fun record(context: Context, kind: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        prefs.edit()
            .putInt("count_$kind", (prefs.getInt("count_$kind", 0) + 1).coerceAtMost(100000))
            .putLong("last_$kind", now)
            .apply()
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val PREFS = "blofy_usage_signals"

        fun preferredKind(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return listOf("live", "movie", "series").maxByOrNull { kind ->
                val count = prefs.getInt("count_$kind", 0).toLong()
                val recentBonus = if (System.currentTimeMillis() - prefs.getLong("last_$kind", 0L) < 24L * 60L * 60L * 1000L) 4L else 0L
                count + recentBonus
            } ?: "movie"
        }

        fun headline(context: Context): String = when (preferredKind(context)) {
            "live" -> "قنواتك المفضلة أقرب لك"
            "series" -> "كمّل مسلسلاتك واكتشف حلقات جديدة"
            else -> "سينما BLOFY مختارة لك"
        }
    }
}
