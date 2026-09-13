package tv.blofy.player.ui.home

import android.view.View
import android.view.ViewGroup
import tv.blofy.player.R

/** Stable, nonvisual identity survives localization and keeps disabled shelves restorable. */
internal object HomeRowOrder {
    const val QUICK_SHORTCUTS = "quick_shortcuts"
    private val managedKeys = setOf("continue_watching", "recent_channels", "watchlist", "latest", "top_rated", "arabic", "uhd")

    fun mark(view: View, key: String) { view.setTag(R.id.blofy_home_row_key, key) }
    fun key(view: View): String? = view.getTag(R.id.blofy_home_row_key) as? String

    fun shelfKey(prefix: String): String = when (prefix) {
        "continue" -> "continue_watching"
        "recent" -> "recent_channels"
        "top" -> "top_rated"
        "4k" -> "uhd"
        else -> prefix
    }

    fun apply(feed: ViewGroup, wantedRows: List<String>) {
        val current = (0 until feed.childCount).map(feed::getChildAt)
        val groups = current.filter { key(it) in managedKeys }.groupBy { checkNotNull(key(it)) }
        groups.forEach { (key, views) ->
            val visibility = if (key in wantedRows) View.VISIBLE else View.GONE
            views.forEach { if (it.visibility != visibility) it.visibility = visibility }
        }
        val unmanaged = current.filter { key(it) !in managedKeys }.toMutableList()
        // Keep the hero first, then the profile shelves, ahead of promotional rows.
        val quickIndex = minOf(1, unmanaged.size)
        val order = wantedRows.distinct() + groups.keys.filterNot { it in wantedRows }
        unmanaged.addAll(quickIndex, order.flatMap { groups[it].orEmpty() })
        HomeRowReconciler.apply(feed, unmanaged)
    }
}
