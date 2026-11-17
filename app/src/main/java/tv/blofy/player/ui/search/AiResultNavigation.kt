package tv.blofy.player.ui.search

import android.content.Context
import android.content.Intent
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/** Only locally verified catalog rows can open details; never model-provided URLs. */
internal object AiResultNavigation {
    fun details(context: Context, item: StreamEntity): Intent? {
        if (item.providerId.isBlank() || item.key.isBlank() || item.locked) return null
        val destination = when (item.kind) {
            "movie" -> MovieDetailsActivity::class.java
            "series" -> SeriesDetailsActivity::class.java
            else -> return null
        }
        return Intent(context, destination).apply {
            putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, item.providerId)
            putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, item.key)
        }
    }

    fun search(context: Context, title: String): Intent? {
        val query = title.trim().take(120)
        if (query.isBlank()) return null
        // Global search includes all locally authorized providers and avoids
        // narrowing a result from one provider to another's active section.
        return Intent(context, SearchActivity::class.java).apply {
            putExtra(SearchActivity.EXTRA_INITIAL_QUERY, query)
        }
    }
}
