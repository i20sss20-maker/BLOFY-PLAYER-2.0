package tv.blofy.player.ui.quick

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.R
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
import tv.blofy.player.ui.guide.LiveGuideActivity
import tv.blofy.player.ui.home.ForYouActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.ProfileWatchlistActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.profile.CloudSyncActivity
import tv.blofy.player.ui.profile.ProfilesActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.CommercialSettingsActivity
import tv.blofy.player.ui.settings.SettingsActivity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

/** Lightweight TV overlay-style hub. It never touches playback/catalog state. */
class QuickMenuActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply { setBackgroundColor(0xC9080710.toInt()) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(16), dp(22), dp(16))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF261832.toInt(), 0xFF120D1A.toInt())).apply {
                cornerRadius = dp(22).toFloat()
                setStroke(dp(1), 0xFF68498A.toInt())
            }
            elevation = dp(16).toFloat()
        }
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            isFocusable = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(panel)
        }
        root.addView(scroll, FrameLayout.LayoutParams(minOf(dp(400), resources.displayMetrics.widthPixels - dp(40)), -1, Gravity.CENTER).apply {
            topMargin = dp(24)
            bottomMargin = dp(24)
        })

        panel.addView(TextView(this).apply {
            text = "BLOFY QUICK MENU"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFB574FF.toInt())
            gravity = Gravity.START
        })
        panel.addView(TextView(this).apply {
            text = getString(R.string.quick_access_title)
            textSize = 26f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(3), 0, dp(10))
        })

        addAction(panel, "✦", getString(R.string.quick_for_you), getString(R.string.quick_for_you_subtitle), Intent(this, ForYouActivity::class.java), true)
        addAction(panel, "▤", getString(R.string.quick_guide), getString(R.string.quick_guide_subtitle), Intent(this, LiveGuideActivity::class.java))
        addAction(panel, "⌕", getString(R.string.quick_search), getString(R.string.quick_search_subtitle), Intent(this, SearchActivity::class.java))
        addAction(panel, "▶", getString(R.string.quick_continue), getString(R.string.quick_continue_subtitle), Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(panel, "＋", getString(R.string.quick_watchlist), getString(R.string.quick_watchlist_subtitle), Intent(this, ProfileWatchlistActivity::class.java))
        addAction(panel, "★", getString(R.string.quick_favorites), getString(R.string.quick_favorites_subtitle), Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(panel, "◉", getString(R.string.quick_recent_channels), getString(R.string.quick_recent_channels_subtitle), Intent(this, RecentChannelsActivity::class.java))
        addAction(panel, "◆", "BLOFY Collections", getString(R.string.quick_collections_subtitle), Intent(this, SmartCollectionsActivity::class.java))
        addAction(panel, "☁", "BLOFY Cloud", getString(R.string.quick_cloud_subtitle), Intent(this, CloudSyncActivity::class.java))
        addAction(panel, "👤", getString(R.string.quick_profiles), getString(R.string.quick_profiles_subtitle), Intent(this, ProfilesActivity::class.java))
        addAction(panel, "◈", getString(R.string.quick_artwork_performance), getString(R.string.quick_artwork_performance_subtitle), Intent(this, CommercialSettingsActivity::class.java))
        addAction(panel, "⚙", getString(R.string.quick_settings), getString(R.string.quick_settings_subtitle), Intent(this, SettingsActivity::class.java))

        setContentView(root)
        panel.post { panel.getChildAt(2)?.requestFocus() }
    }

    private fun addAction(parent: LinearLayout, icon: String, title: String, subtitle: String, intent: Intent, primary: Boolean = false) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            setPadding(dp(14), dp(4), dp(14), dp(4))
            background = itemBackground(false, primary)

            addView(TextView(this@QuickMenuActivity).apply {
                text = icon
                textSize = 19f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0xFFB574FF.toInt())
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(9) })

            val copy = LinearLayout(this@QuickMenuActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                addView(TextView(this@QuickMenuActivity).apply {
                    text = title
                    textSize = 14.6f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.START
                })
                addView(TextView(this@QuickMenuActivity).apply {
                    text = subtitle
                    textSize = 10.4f
                    setTextColor(0xFFB2A7BE.toInt())
                    gravity = Gravity.START
                })
            }
            addView(copy, LinearLayout.LayoutParams(0, dp(49), 1f))

            setOnFocusChangeListener { view, focused ->
                view.background = itemBackground(focused, primary)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.014f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(10).toFloat()) else 0f)
                    .setDuration(TvUiTuning.focusDuration(view.context, focused))
                    .start()
            }
            setOnClickListener { startActivity(intent); finish() }
        }
        parent.addView(row, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(5) })
    }

    private fun itemBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFF6F3BA7.toInt(), 0xFF392151.toInt())
            primary -> intArrayOf(0xFF38204E.toInt(), 0xFF20142C.toInt())
            else -> intArrayOf(0xE6251933.toInt(), 0xE617101F.toInt())
        }
    ).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.FocusStroke else 0xFF49345E.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
