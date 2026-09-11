package tv.blofy.player.ui.profile

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
import tv.blofy.player.ui.home.HomeRowOrder
import java.util.WeakHashMap

/**
 * Applies profile-owned Home composition without modifying playback/catalog engines.
 * Existing shelves are reordered/hidden after Home finishes rendering and a profile Watchlist
 * shelf is injected from the local catalog. The logic is deliberately best-effort so Home can
 * still render normally if its internal layout changes in a later release.
 */
class ProfileHomeLayoutLifecycle : Application.ActivityLifecycleCallbacks {
    private data class WatchlistState(val profileId: String, val name: String, val items: List<StreamEntity>)
    private val watchlistStates = WeakHashMap<View, WatchlistState>()
    private data class Signature(val profileId: String, val name: String, val kids: Boolean,
        val rows: List<String>, val watchlist: List<String>, val children: List<View>)
    private data class Binding(val observer: ViewTreeObserver, val listener: ViewTreeObserver.OnGlobalLayoutListener,
        val preferences: List<SharedPreferences>, val preferenceListener: SharedPreferences.OnSharedPreferenceChangeListener,
        var signature: Signature? = null, var job: Job? = null)
    private val bindings = WeakHashMap<Activity, Binding>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity) return
        onActivityPaused(activity)
        val observer = activity.window.decorView.viewTreeObserver
        val listener = ViewTreeObserver.OnGlobalLayoutListener { apply(activity) }
        val preferences = listOf("blofy_profiles", "blofy_profile_library_v1").map {
            activity.getSharedPreferences(it, Activity.MODE_PRIVATE)
        }
        val preferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            bindings[activity]?.signature = null
            apply(activity)
        }
        bindings[activity] = Binding(observer, listener, preferences, preferenceListener)
        preferences.forEach { it.registerOnSharedPreferenceChangeListener(preferenceListener) }
        observer.addOnGlobalLayoutListener(listener)
        apply(activity)
    }

    private fun apply(activity: HomeActivity) {
        val binding = bindings[activity] ?: return
        if (activity.isFinishing || activity.isDestroyed) return
        val feed = homeFeed(activity) ?: return
        if (feed.childCount < 2) return
        val profile = ProfileStore.active(activity)
        val profileId = profile.id
        val children = (0 until feed.childCount).map(feed::getChildAt)
        binding.signature?.let { previous ->
            if (previous.profileId == profileId && previous.name == profile.name && previous.kids == profile.kids &&
                previous.children == children) return
        }
        val wantedRows = ProfileLibraryStore.homeRows(activity, profileId)
        val signature = Signature(profileId, profile.name, profile.kids, wantedRows,
            ProfileLibraryStore.watchlist(activity, profileId).toList(), children)
        if (binding.signature == signature) return
        binding.signature = signature
        binding.job?.cancel()
        binding.job = activity.lifecycleScope.launch {
            val watchlist = withContext(Dispatchers.IO) { loadWatchlist(activity, profileId, profile.kids) }
            if (bindings[activity] !== binding || activity.isFinishing || activity.isDestroyed) return@launch
            if (ProfileStore.storageNamespace(activity) != profileId) return@launch
            val currentFeed = homeFeed(activity) ?: return@launch
            installWatchlistShelf(activity, currentFeed, wantedRows, watchlist)
            applyExistingRows(currentFeed, wantedRows)
            binding.signature = signature.copy(children = (0 until currentFeed.childCount).map(currentFeed::getChildAt))
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
        HomeRowOrder.apply(feed, wantedRows)
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
            HomeRowOrder.mark(this, "watchlist")
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
            HomeRowOrder.mark(this, "watchlist")
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
        val window = activity.resources.configuration
        val width = tv.blofy.player.ui.home.HomeLayoutSpec(window.screenWidthDp, window.screenHeightDp,
            tv.blofy.player.core.device.DeviceClass.isTv(activity)).posterWidth
        val height = width * 3 / 2
        items.forEach { item ->
            row.addView(card(activity, item), LinearLayout.LayoutParams(dp(activity, width), dp(activity, height)).apply {
                marginStart = dp(activity, 9)
                marginEnd = dp(activity, 3)
            })
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))

        // The stable row reconciler places the complete shelf before quick shortcuts.
        feed.addView(title)
        feed.addView(scroll, LinearLayout.LayoutParams(-1, dp(activity, height + 22)))
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
        setStroke(dp(activity, if (focused) 2 else 1), if (focused) Color.WHITE else 0x45FFFFFF)
    }

    private fun homeFeed(activity: HomeActivity): LinearLayout? = runCatching {
        val field = HomeActivity::class.java.getDeclaredField("homeFeed")
        field.isAccessible = true
        field.get(activity) as? LinearLayout
    }.getOrNull()

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) {
        val binding = bindings.remove(activity) ?: return
        binding.job?.cancel()
        binding.preferences.forEach { it.unregisterOnSharedPreferenceChangeListener(binding.preferenceListener) }
        if (binding.observer.isAlive) binding.observer.removeOnGlobalLayoutListener(binding.listener)
        val current = activity.window.decorView.viewTreeObserver
        if (current.isAlive && current !== binding.observer) current.removeOnGlobalLayoutListener(binding.listener)
    }
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) { onActivityPaused(activity) }

    companion object {
        private const val TAG_WATCHLIST_TITLE = "blofy_profile_home_watchlist_title"
        private const val TAG_WATCHLIST_ROW = "blofy_profile_home_watchlist_row"
    }
}
