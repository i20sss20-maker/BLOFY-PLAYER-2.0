package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.R
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class QuickMenuActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setDimAmount(.58f)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        val uiDirection = resources.configuration.layoutDirection

        val root = FrameLayout(this).apply { setBackgroundColor(Color.TRANSPARENT) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = uiDirection
            setPadding(dp(24), dp(22), dp(24), dp(22))
            background = panelBackground()
            elevation = dp(18).toFloat()
        }
        panel.addView(TextView(this).apply {
            text = "BLOFY QUICK MENU"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.END
        })
        panel.addView(TextView(this).apply {
            text = getString(R.string.quick_menu_title)
            textSize = 25f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.END
            setPadding(0, dp(4), 0, dp(14))
        })

        addAction(panel, "⌕", getString(R.string.home_search), getString(R.string.quick_search_subtitle), Intent(this, SearchActivity::class.java))
        addAction(panel, "▶", getString(R.string.home_continue_compact), getString(R.string.quick_continue_subtitle), Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addAction(panel, "★", getString(R.string.home_favorites), getString(R.string.quick_favorites_subtitle), Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addAction(panel, "◉", getString(R.string.home_recent_channels), getString(R.string.quick_recent_subtitle), Intent(this, RecentChannelsActivity::class.java))
        addAction(panel, "✦", getString(R.string.home_blofy_collections), getString(R.string.quick_collections_subtitle), Intent(this, SmartCollectionsActivity::class.java).putExtra(SmartCollectionsActivity.EXTRA_MODE, SmartCollectionsActivity.MODE_TOP_RATED))
        addAction(panel, "⚙", getString(R.string.home_settings), getString(R.string.quick_settings_subtitle), Intent(this, SettingsActivity::class.java))

        root.addView(panel, FrameLayout.LayoutParams(dp(520), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        setContentView(root)
        panel.post { panel.getChildAt(2)?.requestFocus() }
    }

    private fun addAction(parent: LinearLayout, icon: String, title: String, subtitle: String, intent: Intent) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(10))
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            background = rowBackground(false)
            val iconView = TextView(this@QuickMenuActivity).apply {
                text = icon
                textSize = 21f
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.CENTER
            }
            addView(iconView, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(12) })
            val copy = LinearLayout(this@QuickMenuActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.END
            }
            copy.addView(TextView(this@QuickMenuActivity).apply {
                text = title
                textSize = 15f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
            })
            copy.addView(TextView(this@QuickMenuActivity).apply {
                text = subtitle
                textSize = 11.2f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.END
                maxLines = 1
            })
            addView(copy, LinearLayout.LayoutParams(0, dp(50), 1f))
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.012f else 1f).scaleY(if (focused) 1.012f else 1f)
                    .translationZ(if (focused) dp(8).toFloat() else dp(1).toFloat()).setDuration(65).start()
            }
            setOnClickListener { startActivity(intent); finish() }
        }
        parent.addView(row, LinearLayout.LayoutParams(-1, dp(72)).apply { bottomMargin = dp(6) })
    }

    private fun panelBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFA21142D.toInt(), 0xFA100B17.toInt())
    ).apply {
        cornerRadius = dp(24).toFloat()
        setStroke(dp(1), 0xFF6A4A85.toInt())
    }

    private fun rowBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF6E3BA4.toInt(), 0xFF3A2254.toInt()) else intArrayOf(0xC92A1C3A.toInt(), 0xC9181122.toInt())
    ).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0xFF4A365E.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}