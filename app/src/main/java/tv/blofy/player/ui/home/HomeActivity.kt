package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.mobile.MobileContentActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private var firstAction: View? = null
    private val actionViews = linkedMapOf<String, View>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildClassicTvHome() else buildCompactHome())
        restoreFocus()
    }

    private fun buildClassicTvHome(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(42), dp(26), dp(42), dp(28))
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
            isFocusable = false
        }, LinearLayout.LayoutParams(dp(180), dp(112)).apply { bottomMargin = dp(10) })

        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 28f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))

        root.addView(TextView(this).apply {
            text = "اختر القسم"
            textSize = 15f
            setTextColor(TEXT_MUTED)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)).apply { bottomMargin = dp(16) })

        val primary = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        addClassicAction(primary, "live", "البث المباشر", "◉", contentIntent("live"), primary = true)
        addClassicAction(primary, "movies", "الأفلام", "▣", contentIntent("movie"), primary = true)
        addClassicAction(primary, "series", "المسلسلات", "▤", contentIntent("series"), primary = true)
        root.addView(primary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(150)))

        val secondary = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(18), 0, 0)
            clipChildren = false
            clipToPadding = false
        }
        addClassicAction(secondary, "favorites", "المفضلة", "♡", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES), primary = false)
        addClassicAction(secondary, "continue", "متابعة المشاهدة", "▶", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE), primary = false)
        addClassicAction(secondary, "recent", "آخر القنوات", "↺", Intent(this, RecentChannelsActivity::class.java), primary = false)
        addClassicAction(secondary, "search", "البحث", "⌕", Intent(this, SearchActivity::class.java), primary = false)
        addClassicAction(secondary, "settings", "الإعدادات", "⚙", Intent(this, SettingsActivity::class.java), primary = false)
        root.addView(secondary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(118)))

        return root
    }

    private fun addClassicAction(row: LinearLayout, key: String, label: String, icon: String, intent: Intent, primary: Boolean) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            background = classicTile(false, primary)
            addView(TextView(this@HomeActivity).apply {
                text = icon
                textSize = if (primary) 34f else 26f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(TextView(this@HomeActivity).apply {
                text = label
                textSize = if (primary) 19f else 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (primary) dp(52) else dp(42)))
            setOnFocusChangeListener { view, focused ->
                view.background = classicTile(focused, primary)
                if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                view.animate().cancel()
                view.animate()
                    .scaleX(if (focused) 1.025f else 1f)
                    .scaleY(if (focused) 1.025f else 1f)
                    .translationZ(if (focused) dp(8).toFloat() else 0f)
                    .setDuration(90L)
                    .start()
            }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card)
        row.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
            marginStart = dp(if (primary) 9 else 6)
            marginEnd = dp(if (primary) 9 else 6)
        })
    }

    private fun buildCompactHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46))
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = if (phone) 26f else 32f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_HORIZONTAL
        })
        root.addView(TextView(this).apply {
            text = "اختر القسم"
            textSize = 15f
            setTextColor(TEXT_MUTED)
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(6), 0, dp(24))
        })

        val primary = actionRow(phone)
        addCompactAction(primary, "live", "البث المباشر", contentIntent("live"))
        addCompactAction(primary, "movies", "الأفلام", contentIntent("movie"))
        addCompactAction(primary, "series", "المسلسلات", contentIntent("series"))
        addCompactAction(primary, "search", "البحث", Intent(this, SearchActivity::class.java))
        root.addView(primary)

        val secondary = actionRow(phone).apply { setPadding(0, if (phone) dp(8) else dp(16), 0, 0) }
        addCompactAction(secondary, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java))
        addCompactAction(secondary, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addCompactAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addCompactAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java))
        root.addView(secondary)
        return root
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else {
        Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
    }

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply {
        orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
    }

    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = if (phone) 15f else 16f
            setTextColor(Color.WHITE)
            isFocusable = deviceKind == DeviceClass.Kind.TV
            isFocusableInTouchMode = deviceKind == DeviceClass.Kind.TV
            background = classicTile(false, true)
            setOnFocusChangeListener { view, focused ->
                view.background = classicTile(focused, true)
                if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, button)
        row.addView(button, if (phone) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { bottomMargin = dp(8) }
        } else {
            LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) }
        })
    }

    private fun classicTile(focused: Boolean, primary: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(if (primary) 18 else 15).toFloat()
        setColor(if (focused) FOCUS_FILL else IDLE_FILL)
        setStroke(
            dp(if (focused) 2 else 1),
            if (focused) FOCUS_STROKE else IDLE_STROKE
        )
    }

    private fun registerAction(key: String, view: View) {
        actionViews[key] = view
        if (firstAction == null) firstAction = view
    }

    private fun restoreFocus() {
        if (deviceKind != DeviceClass.Kind.TV) return
        val saved = FocusMemory.restore(this, SCREEN_KEY)
        val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull()
        target?.post { target.requestFocus() }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private val TEXT_MUTED = Color.rgb(177, 169, 191)
        private val IDLE_FILL = Color.rgb(17, 16, 30)
        private val IDLE_STROKE = Color.rgb(69, 55, 88)
        private val FOCUS_FILL = Color.rgb(72, 42, 120)
        private val FOCUS_STROKE = Color.rgb(188, 132, 255)
    }
}
