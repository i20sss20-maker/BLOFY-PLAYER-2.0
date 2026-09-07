package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.profile.KidsPolicy
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.home.HomeRowReconciler
import java.util.WeakHashMap

/**
 * Applies profile-owned Home composition without modifying playback/catalog engines.
 * Existing shelves are reordered/hidden after Home finishes rendering and a profile Watchlist
 * shelf is injected from the local catalog. The logic is deliberately best-effort so Home can
 * still render normally if its internal layout changes in a later release.
 */
class ProfileHomeLayoutLifecycle : Application.ActivityLifecycleCallbacks {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private data class WatchlistState(val profileId: String, val name: String, val items: List<StreamEntity>)
    private val watchlistStates = WeakHashMap<View, WatchlistState>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        // Home data is loaded asynchronously. Retry a few times, then leave the stock Home alone.
        repeat(5) { attempt ->
            activity.window.decorView.postDelayed({ apply(activity) }, 350L + attempt * 350L)
        }
    }

    private fun apply(activity: HomeActivity) {
        if (activity.isFinishing || activity.isDestroyed) return
        val feed = homeFeed(activity) ?: return
        if (feed.childCount < 2) return

        val profileId = ProfileStore.storageNamespace(activity)
        val wantedRows = ProfileLibraryStore.homeRows(activity, profileId)
        val kids = ProfileStore.isKids(activity)

        scope.launch {
            val watchlist = loadWatchlist(activity, profileId, kids)
            withContext(Dispatchers.Main) {
                if (activity.isFinishing || activity.isDestroyed) return@withContext
                // A slow query from the previous profile must not rewrite the current profile's Home.
                if (ProfileStore.storageNamespace(activity) != profileId) return@withContext
                val currentFeed = homeFeed(activity) ?: return@withContext
                installWatchlistShelf(activity, currentFeed, wantedRows, watchlist)
                applyExistingRows(currentFeed, wantedRows)
            }
        }
    }

    private suspend fun loadWatchlist(activity: HomeActivity, profileId: String, kids: Boolean): List<StreamEntity> {
        val keys = ProfileLibraryStore.watchlist(activity.applicationContext, profileId).toList().asReversed().take(18)
        if (keys.isEmpty()) return emptyList()
        val dao = BlofyDatabase.get(activity.applicationContext).dao()
        return keys.mapNotNull { dao.stream(it) }
            .filter { !kids || !KidsPolicy.isBlocked(it.name, it.genre, it.plot) }
            .take(18)
    }

    private fun applyExistingRows(feed: LinearLayout, wantedRows: List<String>) {
        val groups = mutableMapOf<String, List<View>>()
        var index = 1 // child 0 is the hero and must never move.
        while (index < feed.childCount) {
            val child = feed.getChildAt(index)
            val title = sectionTitle(child)
            val rowKey = titleToRowKey(title)
            if (rowKey != null) {
                val block = mutableListOf<View>(child)
                if (index + 1 < feed.childCount && sectionTitle(feed.getChildAt(index + 1)) == null) {
                    block += feed.getChildAt(index + 1)
                }
                groups[rowKey] = block
                index += block.size
            } else index++
        }

        // Compare the complete intended order before detaching anything. The lifecycle retries
        // while Home loads; a retry with the same rows must not reset focus or horizontal scroll.
        val managed = groups.values.flatten().toSet()
        val desired = (0 until feed.childCount).map(feed::getChildAt).filterNot { it in managed }.toMutableList()
        val quickIndex = desired.indexOfFirst { sectionTitle(it) == "اختصارات سريعة" }
            .takeIf { it >= 0 } ?: desired.size
        val ordered = wantedRows.distinct().flatMap { groups[it].orEmpty() }
        desired.addAll(quickIndex, ordered)
        HomeRowReconciler.apply(feed, desired)
    }

    private fun installWatchlistShelf(
        activity: HomeActivity,
        feed: LinearLayout,
        wantedRows: List<String>,
        items: List<StreamEntity>,
    ) {
        val oldTitle = feed.findViewWithTag<View>(TAG_WATCHLIST_TITLE)
        val oldRow = feed.findViewWithTag<View>(TAG_WATCHLIST_ROW)
        val profile = ProfileStore.active(activity)
        val state = WatchlistState(profile.id, profile.name, items.toList())
        if ("watchlist" in wantedRows && items.isNotEmpty() && oldTitle != null && oldRow != null &&
            watchlistStates[oldRow] == state) return
        val focusedTag = oldRow?.findFocus()?.tag as? String
        if (oldTitle != null) feed.removeView(oldTitle)
        if (oldRow != null) { watchlistStates.remove(oldRow); feed.removeView(oldRow) }
        if ("watchlist" !in wantedRows || items.isEmpty()) return

        val title = LinearLayout(activity).apply {
            tag = TAG_WATCHLIST_TITLE
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
            setPadding(0, dp(activity, 12), dp(activity, 4), dp(activity, 6))
            addView(TextView(activity).apply {
                text = "قائمتي"
                textSize = 19f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.rgb(249, 247, 252))
                gravity = Gravity.RIGHT
            })
            addView(TextView(activity).apply {
                text = "اختيارات ${ProfileStore.active(activity).name}"
                textSize = 11.5f
                setTextColor(Color.rgb(172, 160, 188))
                gravity = Gravity.RIGHT
            })
        }

        val scroll = HorizontalScrollView(activity).apply {
            tag = TAG_WATCHLIST_ROW
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipChildren = false
            clipToPadding = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(activity, 4), dp(activity, 5), dp(activity, 4), dp(activity, 12))
            clipChildren = false
            clipToPadding = false
        }
        items.forEach { item ->
            row.addView(card(activity, item), LinearLayout.LayoutParams(dp(activity, 154), dp(activity, 226)).apply {
                marginStart = dp(activity, 9)
                marginEnd = dp(activity, 3)
            })
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))

        val managedPosition = wantedRows.indexOf("watchlist")
        val beforeRows = wantedRows.take(managedPosition).count { it != "watchlist" }
        var insertAt = 1
        var seen = 0
        while (insertAt < feed.childCount && seen < beforeRows) {
            val key = titleToRowKey(sectionTitle(feed.getChildAt(insertAt)))
            if (key != null) seen++
            insertAt++
            if (insertAt < feed.childCount && sectionTitle(feed.getChildAt(insertAt)) == null) insertAt++
        }
        feed.addView(title, insertAt.coerceAtMost(feed.childCount))
        feed.addView(scroll, (insertAt + 1).coerceAtMost(feed.childCount), LinearLayout.LayoutParams(-1, dp(activity, 246)))
        watchlistStates[scroll] = state
        // Preserve the same title if its card was replaced; never select a removed title by index.
        focusedTag?.let { scroll.findViewWithTag<View>(it)?.requestFocus() }
    }

    private fun card(activity: HomeActivity, item: StreamEntity) = FrameLayout(activity).apply {
        tag = "blofy_profile_watchlist_item:${item.key}"
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        clipChildren = false
        background = cardBackground(activity, false)

        val poster = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF17101F.toInt())
        }
        addView(poster, FrameLayout.LayoutParams(-1, -1).apply {
            setMargins(dp(activity, 4), dp(activity, 4), dp(activity, 4), dp(activity, 4))
        })
        ArtworkLoader.loadPriority(poster, listOf(item.icon, item.backdrop))

        val shade = View(activity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xED0C0812.toInt(), 0x700C0812, Color.TRANSPARENT))
        }
        addView(shade, FrameLayout.LayoutParams(-1, dp(activity, 88), Gravity.BOTTOM))
        addView(TextView(activity).apply {
            text = item.name
            textSize = 12.2f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 2
            setTextColor(Color.WHITE)
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            setPadding(dp(activity, 10), dp(activity, 8), dp(activity, 10), dp(activity, 11))
        }, FrameLayout.LayoutParams(-1, dp(activity, 88), Gravity.BOTTOM))

        setOnFocusChangeListener { view, focused ->
            view.background = cardBackground(activity, focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.065f else 1f).scaleY(if (focused) 1.065f else 1f)
                .translationZ(if (focused) dp(activity, 15).toFloat() else dp(activity, 1).toFloat())
                .setDuration(85).start()
        }
        setOnClickListener {
            activity.startActivity(Intent(activity, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
                putExtra("provider_id", item.providerId)
                putExtra("content_key", item.key)
            })
        }
    }

    private fun cardBackground(activity: Activity, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF9A55F0.toInt(), 0xFF522777.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())
    ).apply {
        cornerRadius = dp(activity, 15).toFloat()
        setStroke(dp(activity, if (focused) 3 else 1), if (focused) 0xFFE1C5FF.toInt() else 0xFF49365A.toInt())
    }

    private fun homeFeed(activity: HomeActivity): LinearLayout? = runCatching {
        val field = HomeActivity::class.java.getDeclaredField("homeFeed")
        field.isAccessible = true
        field.get(activity) as? LinearLayout
    }.getOrNull()

    private fun sectionTitle(view: View): String? {
        if (view.tag == TAG_WATCHLIST_TITLE) return "قائمتي"
        if (view !is ViewGroup || view.childCount == 0) return null
        val first = view.getChildAt(0) as? TextView ?: return null
        return first.text?.toString()?.trim()?.takeIf(String::isNotBlank)
    }

    private fun titleToRowKey(title: String?): String? = when (title) {
        "قائمتي" -> "watchlist"
        "تابع المشاهدة" -> "continue_watching"
        "شاهدت مؤخرًا" -> "recent_channels"
        "أضيف حديثًا" -> "latest"
        "الأعلى تقييمًا" -> "top_rated"
        "مختارات عربية" -> "arabic"
        "4K • UHD" -> "uhd"
        else -> null
    }

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        private const val TAG_WATCHLIST_TITLE = "blofy_profile_home_watchlist_title"
        private const val TAG_WATCHLIST_ROW = "blofy_profile_home_watchlist_row"
    }
}
