package tv.blofy.player.ui.player

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.search.SectionSearchActivity
import tv.blofy.player.ui.series.EpisodesActivity
import java.util.WeakHashMap

/**
 * Keeps fullscreen playback attached to the screen that opened it.
 *
 * The playback Activity still owns BACK and its HUD exactly as before. This lifecycle only reacts
 * after PlayerActivity has already decided to finish, then reorders the recorded source Activity
 * to the front. That means Media3/FFmpeg/session behavior is untouched while Android TV no longer
 * skips Details/Live context and falls through to a higher-level catalog or Home screen.
 */
class PlayerReturnNavigationLifecycle : Application.ActivityLifecycleCallbacks {
    private val targets = WeakHashMap<PlayerActivity, ReturnTarget>()
    private var pendingSource: ReturnTarget? = null

    override fun onActivityResumed(activity: Activity) {
        if (activity is PlayerActivity) {
            val kind = activity.intent.getStringExtra(PlayerActivity.EXTRA_KIND).orEmpty()
            val remembered = pendingSource?.takeIf { it.supports(kind) }
            targets[activity] = remembered ?: fallback(activity, kind) ?: return
            return
        }
        sourceFor(activity)?.let { pendingSource = it }
    }

    override fun onActivityPaused(activity: Activity) {
        if (activity is PlayerActivity) {
            if (!activity.isFinishing || activity.isChangingConfigurations) return
            val target = targets.remove(activity) ?: return
            activity.startActivity(target.intent(activity).apply {
                addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            })
            return
        }
        if (!activity.isFinishing) sourceFor(activity)?.let { pendingSource = it }
    }

    override fun onActivityDestroyed(activity: Activity) {
        if (activity is PlayerActivity) targets.remove(activity)
    }

    private fun sourceFor(activity: Activity): ReturnTarget? = when (activity) {
        is ContentBrowserActivity -> {
            val kind = activity.intent.getStringExtra(ContentBrowserActivity.EXTRA_KIND).orEmpty().ifBlank { KIND_LIVE }
            if (kind != KIND_LIVE) null else ReturnTarget(
                Destination.LIVE,
                Bundle().apply { putString(ContentBrowserActivity.EXTRA_KIND, KIND_LIVE) }
            )
        }
        is MovieDetailsActivity -> ReturnTarget(
            Destination.MOVIE_DETAILS,
            Bundle().apply {
                putString(MovieDetailsActivity.EXTRA_PROVIDER_ID, activity.intent.getStringExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID))
                putString(MovieDetailsActivity.EXTRA_CONTENT_KEY, activity.intent.getStringExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY))
            }
        )
        is SeriesDetailsActivity -> ReturnTarget(
            Destination.SERIES_DETAILS,
            Bundle().apply {
                putString(SeriesDetailsActivity.EXTRA_PROVIDER_ID, activity.intent.getStringExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID))
                putString(SeriesDetailsActivity.EXTRA_CONTENT_KEY, activity.intent.getStringExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY))
            }
        )
        is EpisodesActivity -> ReturnTarget(
            Destination.EPISODES,
            Bundle().apply {
                putString(EpisodesActivity.EXTRA_PROVIDER_ID, activity.intent.getStringExtra(EpisodesActivity.EXTRA_PROVIDER_ID))
                putString(EpisodesActivity.EXTRA_SERIES_ID, activity.intent.getStringExtra(EpisodesActivity.EXTRA_SERIES_ID))
                putString(EpisodesActivity.EXTRA_SERIES_NAME, activity.intent.getStringExtra(EpisodesActivity.EXTRA_SERIES_NAME))
                putString(EpisodesActivity.EXTRA_SERIES_ART, activity.intent.getStringExtra(EpisodesActivity.EXTRA_SERIES_ART))
            }
        )
        is SectionSearchActivity -> ReturnTarget(
            Destination.SECTION_SEARCH,
            Bundle().apply { putString(SectionSearchActivity.EXTRA_KIND, activity.intent.getStringExtra(SectionSearchActivity.EXTRA_KIND)) }
        )
        else -> null
    }

    private fun fallback(player: PlayerActivity, kind: String): ReturnTarget? = when (kind) {
        KIND_LIVE -> ReturnTarget(
            Destination.LIVE,
            Bundle().apply { putString(ContentBrowserActivity.EXTRA_KIND, KIND_LIVE) }
        )
        KIND_MOVIE -> {
            val providerId = player.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            val contentKey = player.intent.getStringExtra(PlayerActivity.EXTRA_CONTENT_KEY).orEmpty()
            if (providerId.isBlank() || contentKey.isBlank()) null else ReturnTarget(
                Destination.MOVIE_DETAILS,
                Bundle().apply {
                    putString(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId)
                    putString(MovieDetailsActivity.EXTRA_CONTENT_KEY, contentKey)
                }
            )
        }
        KIND_EPISODE -> {
            val providerId = player.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            val seriesId = player.intent.getStringExtra(PlayerActivity.EXTRA_SERIES_ID).orEmpty()
            if (providerId.isBlank() || seriesId.isBlank()) null else ReturnTarget(
                Destination.EPISODES,
                Bundle().apply {
                    putString(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putString(EpisodesActivity.EXTRA_SERIES_ID, seriesId)
                }
            )
        }
        else -> null
    }

    private data class ReturnTarget(val destination: Destination, val extras: Bundle) {
        fun supports(playerKind: String): Boolean = when (destination) {
            Destination.LIVE -> playerKind == KIND_LIVE
            Destination.MOVIE_DETAILS -> playerKind == KIND_MOVIE
            Destination.SERIES_DETAILS, Destination.EPISODES -> playerKind == KIND_EPISODE
            Destination.SECTION_SEARCH -> extras.getString(SectionSearchActivity.EXTRA_KIND) == playerKind
        }

        fun intent(activity: Activity): Intent {
            val target = when (destination) {
                Destination.LIVE -> ContentBrowserActivity::class.java
                Destination.MOVIE_DETAILS -> MovieDetailsActivity::class.java
                Destination.SERIES_DETAILS -> SeriesDetailsActivity::class.java
                Destination.EPISODES -> EpisodesActivity::class.java
                Destination.SECTION_SEARCH -> SectionSearchActivity::class.java
            }
            return Intent(activity, target).putExtras(Bundle(extras))
        }
    }

    private enum class Destination { LIVE, MOVIE_DETAILS, SERIES_DETAILS, EPISODES, SECTION_SEARCH }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    private companion object {
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_EPISODE = "episode"
    }
}
