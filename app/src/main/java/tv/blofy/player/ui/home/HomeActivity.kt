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
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvHome() else buildCompactHome())
        restoreFocus()
    }

    private fun buildTvHome(): FrameLayout {
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            clipChildren = false; clipToPadding = false
        }
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(22), dp(18), dp(22), dp(18))
            clipChildren = false; clipToPadding = false
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(205), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(22) })

        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false; clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

        main.addView(TextView(this).apply {
            text = "مرحبًا بك في BLOFY PLAYER"
            textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)))

        main.addView(buildHero(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.5f))

        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(14), 0, dp(14)); clipChildren = false
        }
        quick.addView(infoCard("تابع المشاهدة", "أكمل من آخر نقطة", "continue", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(12) })
        quick.addView(infoCard("آخر القنوات", "ارجع مباشرة للبث", "recent", Intent(this, RecentChannelsActivity::class.java)), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        main.addView(quick, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, .72f))

        main.addView(TextView(this).apply {
            text = "استكشف"
            textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)))

        val cards = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER; clipChildren = false
        }
        addStory(cards, "live_story", "البث المباشر", "قنواتك الآن", contentIntent("live"))
        addStory(cards, "movie_story", "الأفلام", "كل السينما", contentIntent("movie"))
        addStory(cards, "series_story", "المسلسلات", "المواسم والحلقات", contentIntent("series"))
        addStory(cards, "favorite_story", "المفضلة", "اختياراتك", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addStory(cards, "search_story", "البحث", "ابحث فورًا", Intent(this, SearchActivity::class.java))
        main.addView(cards, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, .62f))
        return root
    }

    private fun buildSidebar() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = surface(true)
        elevation = dp(5).toFloat()
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE; adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(125), dp(92)).apply { bottomMargin = dp(10) })
        addView(sideSelected("⌂", "الرئيسية"))
        addView(sideAction("side_live", "◉", "بث مباشر", contentIntent("live")))
        addView(sideAction("side_movies", "▣", "الأفلام", contentIntent("movie")))
        addView(sideAction("side_series", "▤", "المسلسلات", contentIntent("series")))
        addView(sideAction("side_favorites", "♡", "المفضلة", Intent(this@HomeActivity, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)))
        addView(sideAction("side_search", "⌕", "بحث", Intent(this@HomeActivity, SearchActivity::class.java)))
        addView(sideAction("side_settings", "⚙", "الإعدادات", Intent(this@HomeActivity, SettingsActivity::class.java)))
    }

    private fun sideBase(icon: String, label: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(14), 0, dp(14), 0)
        addView(TextView(this@HomeActivity).apply { text = label; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        addView(TextView(this@HomeActivity).apply { text = icon; textSize = 21f; setTextColor(PURPLE); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(40), LinearLayout.LayoutParams.MATCH_PARENT))
    }.also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { bottomMargin = dp(5) } }

    private fun sideSelected(icon: String, label: String) = sideBase(icon, label).apply { background = softPurpleSurface() }

    private fun sideAction(key: String, icon: String, label: String, intent: Intent) = sideBase(icon, label).apply {
        id = View.generateViewId(); isFocusable = true; isFocusableInTouchMode = true; isClickable = true
        background = transparentSurface(false)
        setOnFocusChangeListener { view, focused ->
            view.background = transparentSurface(focused)
            childrenTextColor(this, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).translationZ(if (focused) dp(8).toFloat() else 1f).setDuration(85).start()
        }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun buildHero() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(38), dp(24), dp(38), dp(24))
        background = heroSurface(); elevation = dp(4).toFloat()
        addView(TextView(this@HomeActivity).apply { text = "BLOFY PREMIUM"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = "كل محتواك في مكان واحد"; textSize = 37f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT; setPadding(0, dp(7), 0, 0) })
        addView(TextView(this@HomeActivity).apply { text = "بث مباشر، أفلام ومسلسلات بواجهة سريعة وواضحة مصممة للتلفزيون."; textSize = 17f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; setPadding(0, dp(8), 0, dp(20)) })
        val row = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT }
        row.addView(heroButton("شاهد الآن", "hero_watch", contentIntent("live"), true), LinearLayout.LayoutParams(dp(180), dp(60)).apply { marginStart = dp(10) })
        row.addView(heroButton("استكشف الأفلام", "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(185), dp(60)))
        addView(row)
    }

    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD
        isFocusable = true; isFocusableInTouchMode = true
        setTextColor(if (primary) Color.WHITE else TEXT_PRIMARY); background = buttonSurface(primary, false)
        setOnFocusChangeListener { view, focused ->
            setTextColor(if (primary || focused) Color.WHITE else TEXT_PRIMARY)
            view.background = buttonSurface(primary, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(85).start()
        }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun infoCard(title: String, subtitle: String, key: String, intent: Intent) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(24), dp(16), dp(24), dp(16))
        background = surface(false); isFocusable = true; isFocusableInTouchMode = true; isClickable = true
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 13f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT; setPadding(0, dp(5), 0, dp(10)) })
        addView(TextView(this@HomeActivity).apply { text = "استمرار  ←"; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE); gravity = Gravity.RIGHT })
        setOnFocusChangeListener { view, focused ->
            view.background = surface(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).setDuration(80).start()
        }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun addStory(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16), dp(13), dp(16), dp(13))
            background = storySurface(false); isFocusable = true; isFocusableInTouchMode = true; isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
            setOnFocusChangeListener { view, focused ->
                view.background = storySurface(focused); childrenTextColor(this, focused)
                if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).translationZ(if (focused) dp(9).toFloat() else 1f).setDuration(85).start()
            }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card)
        row.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(6); marginEnd = dp(6) })
    }

    private fun buildCompactHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46))
            setBackgroundColor(theme.background); layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        root.addView(title("BLOFY PLAYER", if (phone) 26f else 32f)); root.addView(subtitle("كل محتواك. أسرع. أبسط.", if (phone) dp(20) else dp(30)))
        val primary = actionRow(phone)
        addCompactAction(primary, "live", "البث المباشر", contentIntent("live")); addCompactAction(primary, "movies", "الأفلام", contentIntent("movie")); addCompactAction(primary, "series", "المسلسلات", contentIntent("series")); addCompactAction(primary, "search", "البحث", Intent(this, SearchActivity::class.java)); root.addView(primary)
        val secondary = actionRow(phone).apply { setPadding(0, if (phone) dp(8) else dp(16), 0, 0) }
        addCompactAction(secondary, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java)); addCompactAction(secondary, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)); addCompactAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)); addCompactAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java)); root.addView(secondary)
        return root
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind) else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE; val button = compactButton(key, label, intent)
        row.addView(button, if (phone) LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { bottomMargin = dp(8) } else LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) })
    }
    private fun compactButton(key: String, label: String, intent: Intent) = Button(this).apply {
        text = label; isAllCaps = false; textSize = if (deviceKind == DeviceClass.Kind.PHONE) 15f else 16f; setTextColor(TEXT_PRIMARY); background = compactTile(false)
        setOnFocusChangeListener { view, focused -> setTextColor(if (focused) Color.WHITE else TEXT_PRIMARY); view.background = compactTile(focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key) }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE else TEXT_PRIMARY) }

    private fun surface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(if (focused) 0xFFF4EEFF.toInt() else Color.WHITE); setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE else 0xFFE0DCE7.toInt()) }
    private fun softPurpleSurface() = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(0xFFF0E7FF.toInt()); setStroke(dp(1), 0xFFD0B5F2.toInt()) }
    private fun transparentSurface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(15).toFloat(); setColor(if (focused) PURPLE else Color.TRANSPARENT); if (focused) setStroke(dp(1), 0xFFB58DE8.toInt()) }
    private fun heroSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFFFFFFFF.toInt(), 0xFFF4EEFC.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(dp(1), 0xFFDDD4E8.toInt()) }
    private fun storySurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF8245D8.toInt(), 0xFF6630B5.toInt()) else intArrayOf(0xFFFFFFFF.toInt(), 0xFFF8F5FB.toInt())).apply { cornerRadius = dp(17).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFB991E9.toInt() else 0xFFE0DCE7.toInt()) }
    private fun buttonSurface(primary: Boolean, focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(15).toFloat(); setColor(if (primary || focused) if (focused) 0xFF7A3ED2.toInt() else PURPLE else Color.WHITE); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFB991E9.toInt() else 0xFFD8D2E0.toInt()) }
    private fun compactTile(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(if (focused) PURPLE else theme.surface); setStroke(dp(if (focused) 2 else 1), if (focused) 0xFFB991E9.toInt() else 0xFFD8D2E0.toInt()) }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(PURPLE); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private val PURPLE = Color.rgb(105, 49, 190)
        private val TEXT_PRIMARY = Color.rgb(28, 24, 34)
        private val TEXT_SECONDARY = Color.rgb(78, 72, 86)
        private val TEXT_MUTED = Color.rgb(126, 118, 138)
    }
}
