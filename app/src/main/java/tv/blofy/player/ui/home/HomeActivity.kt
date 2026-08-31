package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
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
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildBlofyTvHome() else buildCompactHome())
        restoreFocus()
    }

    /**
     * BLOFY TV home. Playback, content-browser and mini-player behavior stay behind the
     * same intents; this screen owns presentation and DPAD focus only.
     */
    private fun buildBlofyTvHome(): FrameLayout {
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(50), dp(26), dp(50), dp(24))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        content.addView(buildHeader(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(70)))
        content.addView(buildHero(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.82f))

        val primary = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        addPrimaryCard(primary, "live", "●", "البث المباشر", "قنواتك مباشرةً وبسرعة", contentIntent("live"))
        addPrimaryCard(primary, "movies", "▶", "الأفلام", "مكتبتك السينمائية", contentIntent("movie"))
        addPrimaryCard(primary, "series", "▦", "المسلسلات", "تابع حلقاتك بسهولة", contentIntent("series"))
        content.addView(primary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.55f))

        val secondary = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
            setPadding(0, dp(15), 0, 0)
        }
        addUtilityCard(secondary, "favorites", "♡", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addUtilityCard(secondary, "continue", "↻", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        addUtilityCard(secondary, "recent", "◷", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java))
        addUtilityCard(secondary, "settings", "⚙", "الإعدادات", Intent(this, SettingsActivity::class.java))
        content.addView(secondary, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.88f))
        return root
    }

    private fun buildHeader(): LinearLayout {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
            clipToPadding = false
        }
        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        brand.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = "BLOFY PLAYER"
        }, LinearLayout.LayoutParams(dp(58), dp(58)))
        brand.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, 0, 0)
            addView(TextView(this@HomeActivity).apply {
                text = "BLOFY"
                textSize = 21f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                letterSpacing = 0.06f
                setTextColor(Color.WHITE)
            })
            addView(TextView(this@HomeActivity).apply {
                text = "PLAYER"
                textSize = 9f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                letterSpacing = 0.28f
                setTextColor(PURPLE_SOFT)
                setPadding(dp(1), dp(1), 0, 0)
            })
        })
        header.addView(brand, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        nav.addView(selectedNavItem("الرئيسية"))
        nav.addView(navAction("nav_live", "بث مباشر", contentIntent("live")))
        nav.addView(navAction("nav_movies", "أفلام", contentIntent("movie")))
        nav.addView(navAction("nav_series", "مسلسلات", contentIntent("series")))
        nav.addView(navAction("nav_search", "بحث", Intent(this, SearchActivity::class.java)))
        header.addView(nav, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT))
        return header
    }

    private fun buildHero(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        addView(TextView(this@HomeActivity).apply {
            text = "كل محتواك في مكان واحد"
            textSize = 30f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        addView(TextView(this@HomeActivity).apply {
            text = "تصميم جديد كلياً - واجهة فخمة وسلسة"
            textSize = 14f
            setTextColor(PURPLE_SOFT)
            gravity = Gravity.START
            setPadding(0, dp(5), 0, dp(10))
        })
    }

    private fun addPrimaryCard(row: LinearLayout, key: String, icon: String, title: String, subtitle: String, intent: Intent) {
        val card = actionCard(key, icon, title, subtitle, intent, large = true)
        row.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
            marginEnd = if (key == "series") 0 else dp(16)
        })
    }

    private fun addUtilityCard(row: LinearLayout, key: String, icon: String, title: String, intent: Intent) {
        val card = actionCard(key, icon, title, null, intent, large = false)
        row.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
            marginEnd = if (key == "settings") 0 else dp(13)
        })
    }

    private fun actionCard(key: String, icon: String, title: String, subtitle: String?, intent: Intent, large: Boolean): LinearLayout {
        val card = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = if (large) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            gravity = if (large) Gravity.CENTER_VERTICAL or Gravity.START else Gravity.CENTER
            setPadding(if (large) dp(24) else dp(18), dp(14), if (large) dp(24) else dp(18), dp(14))
            background = cardBackground(focused = false, large = large)
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            elevation = dp(5).toFloat()
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val iconView = TextView(this).apply {
            text = icon
            textSize = if (large) 24f else 20f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = iconBackground()
        }
        card.addView(iconView, LinearLayout.LayoutParams(if (large) dp(54) else dp(42), if (large) dp(54) else dp(42)).apply {
            if (!large) marginEnd = dp(13)
        })

        val copy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (large) Gravity.START else Gravity.CENTER_VERTICAL
            if (large) setPadding(0, dp(13), 0, 0)
        }
        copy.addView(TextView(this).apply {
            text = title
            textSize = if (large) 22f else 16f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            maxLines = 1
        })
        if (subtitle != null) {
            copy.addView(TextView(this).apply {
                text = subtitle
                textSize = 12.5f
                setTextColor(TEXT_MUTED)
                gravity = Gravity.START
                maxLines = 1
                setPadding(0, dp(4), 0, 0)
            })
        }
        card.addView(copy, if (large) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        } else {
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })

        card.setOnFocusChangeListener { view, focused ->
            view.background = cardBackground(focused, large)
            if (focused) FocusMemory.save(this, SCREEN_KEY, key)
            view.animate()
                .scaleX(if (focused) 1.035f else 1f)
                .scaleY(if (focused) 1.035f else 1f)
                .translationZ(if (focused) dp(14).toFloat() else dp(5).toFloat())
                .setDuration(125L)
                .start()
        }
        card.setOnClickListener {
            FocusMemory.save(this, SCREEN_KEY, key)
            startActivity(intent)
        }
        registerAction(key, card)
        return card
    }

    private fun selectedNavItem(label: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(13), 0, dp(13), 0)
        addView(TextView(this@HomeActivity).apply {
            text = label
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        addView(View(this@HomeActivity).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(2).toFloat()
                setColor(PURPLE_SOFT)
            }
        }, LinearLayout.LayoutParams(dp(30), dp(3)).apply { topMargin = dp(7) })
    }

    private fun navAction(key: String, label: String, intent: Intent): TextView = TextView(this).apply {
        id = View.generateViewId()
        text = label
        textSize = 13.5f
        gravity = Gravity.CENTER
        setTextColor(TEXT_MUTED)
        setPadding(dp(13), dp(10), dp(13), dp(10))
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = navBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = navBackground(focused)
            (view as TextView).setTextColor(if (focused) Color.WHITE else TEXT_MUTED)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
        }
        setOnClickListener {
            FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            startActivity(intent)
        }
        registerAction(key, this)
    }

    private fun buildCompactHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46))
            setBackgroundColor(theme.background)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        root.addView(title("BLOFY PLAYER", if (phone) 26f else 32f))
        root.addView(subtitle("كل محتواك. أسرع. أبسط.", if (phone) dp(20) else dp(30)))

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
        if (kind == "live") {
            Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        } else {
            Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
        }
    } else {
        Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
    }

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply {
        orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        clipChildren = false
        clipToPadding = false
    }

    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = compactButton(key, label, intent)
        row.addView(button, if (phone) {
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { bottomMargin = dp(8) }
        } else {
            LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) }
        })
    }

    private fun compactButton(key: String, label: String, intent: Intent) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label
        isAllCaps = false
        textSize = if (deviceKind == DeviceClass.Kind.PHONE) 15f else 16f
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = compactTile(false)
        setOnFocusChangeListener { view, focused ->
            if (!tv) return@setOnFocusChangeListener
            view.background = compactTile(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun registerAction(key: String, view: View) {
        actionViews[key] = view
        if (firstAction == null && key == "live") firstAction = view
    }

    private fun restoreFocus() {
        if (deviceKind != DeviceClass.Kind.TV) return
        val saved = FocusMemory.restore(this, SCREEN_KEY)
        val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull()
        target?.post { target.requestFocus() }
    }

    private fun cardBackground(focused: Boolean, large: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF6222B8.toInt(), 0xFF27133F.toInt())
        else if (large) intArrayOf(0xEE1D1730.toInt(), 0xF0120E20.toInt())
        else intArrayOf(0xE8191526.toInt(), 0xF00E0B17.toInt())
    ).apply {
        cornerRadius = dp(if (large) 24 else 19).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) 0xFFE0B5FF.toInt() else 0x554D376B)
    }

    private fun iconBackground() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF9F3FFF.toInt(), 0xFF5520B7.toInt())).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(dp(1), 0x66FFFFFF)
    }

    private fun navBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(if (focused) 0x4D8B37FF else Color.TRANSPARENT)
        if (focused) setStroke(dp(1), 0x998B5CF6.toInt())
    }

    private fun compactTile(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(if (focused) blend(theme.surface, theme.accent, 0.34f) else theme.surface)
        setStroke(dp(if (focused) 3 else 1), if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.12f))
    }

    private fun title(value: String, size: Float) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(Color.WHITE)
        gravity = Gravity.START
    }

    private fun subtitle(value: String, bottom: Int) = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(theme.accent)
        gravity = Gravity.START
        setPadding(0, dp(4), 0, bottom)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun blend(a: Int, b: Int, ratio: Float): Int {
        val r = (Color.red(a) * (1f - ratio) + Color.red(b) * ratio).toInt()
        val g = (Color.green(a) * (1f - ratio) + Color.green(b) * ratio).toInt()
        val bl = (Color.blue(a) * (1f - ratio) + Color.blue(b) * ratio).toInt()
        return Color.rgb(r, g, bl)
    }

    companion object {
        private const val SCREEN_KEY = "home"
        private val PURPLE_SOFT = Color.rgb(195, 135, 255)
        private val TEXT_MUTED = Color.rgb(177, 169, 191)
    }
}
