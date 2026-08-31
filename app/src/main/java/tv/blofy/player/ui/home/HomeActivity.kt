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
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildApprovedTvHome() else buildCompactHome())
        restoreFocus()
    }

    private fun buildApprovedTvHome(): FrameLayout {
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(12), dp(10), dp(12), dp(10))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, 0, dp(12), 0)
            clipChildren = false
            clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        shell.addView(buildRightSidebar(), LinearLayout.LayoutParams(dp(190), LinearLayout.LayoutParams.MATCH_PARENT))

        main.addView(TextView(this).apply {
            text = "اكتشف الآن"
            textSize = 25f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)))

        main.addView(buildHeroCard(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.55f))

        val middle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(10), 0, dp(10))
            clipChildren = false
            clipToPadding = false
        }
        middle.addView(buildContinueCard(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.1f).apply { marginStart = dp(10) })
        middle.addView(buildLastChannelCard(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.85f))
        main.addView(middle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.72f))

        main.addView(TextView(this).apply {
            text = "قصص مختارة"
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)))

        val stories = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        addStoryCard(stories, "live_story", "البث المباشر", "شاهد الآن", contentIntent("live"))
        addStoryCard(stories, "movie_story", "أحدث الأفلام", "سينما", contentIntent("movie"))
        addStoryCard(stories, "series_story", "أحدث المسلسلات", "حلقات جديدة", contentIntent("series"))
        addStoryCard(stories, "favorite_story", "المفضلة", "اختياراتك", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addStoryCard(stories, "continue_story", "تابع المشاهدة", "من حيث توقفت", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE))
        main.addView(stories, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.62f))
        return root
    }

    private fun buildRightSidebar(): LinearLayout {
        val side = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = sidebarBackground()
            clipChildren = false
            clipToPadding = false
        }
        side.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(120), dp(92)).apply { bottomMargin = dp(8) })

        side.addView(sidebarSelected("⌂", "الرئيسية"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { bottomMargin = dp(5) })
        side.addView(sidebarAction("side_live", "◉", "بث مباشر", contentIntent("live")))
        side.addView(sidebarAction("side_movies", "▣", "الأفلام", contentIntent("movie")))
        side.addView(sidebarAction("side_series", "▤", "المسلسلات", contentIntent("series")))
        side.addView(sidebarAction("side_favorites", "♡", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)))
        side.addView(sidebarAction("side_search", "⌕", "بحث", Intent(this, SearchActivity::class.java)))
        side.addView(sidebarAction("side_settings", "⚙", "الإعدادات", Intent(this, SettingsActivity::class.java)))
        return side
    }

    private fun sidebarSelected(icon: String, label: String): LinearLayout = sidebarBase(icon, label).apply {
        background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(blend(theme.accent, Color.BLACK, 0.28f), theme.accent)).apply {
            cornerRadius = dp(17).toFloat()
            setStroke(dp(1), blend(theme.accent, Color.WHITE, 0.42f))
        }
    }

    private fun sidebarAction(key: String, icon: String, label: String, intent: Intent): LinearLayout = sidebarBase(icon, label).apply {
        id = View.generateViewId()
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = sideItemBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = sideItemBackground(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) theme.focusScale.coerceAtMost(1.04f) else 1f).scaleY(if (focused) theme.focusScale.coerceAtMost(1.04f) else 1f).setDuration(theme.motionMs).start()
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun sidebarBase(icon: String, label: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(15), 0, dp(15), 0)
        addView(TextView(this@HomeActivity).apply {
            text = label
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        addView(TextView(this@HomeActivity).apply {
            text = icon
            textSize = 22f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(42), LinearLayout.LayoutParams.MATCH_PARENT))
    }.also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)).apply { bottomMargin = dp(4) } }

    private fun buildHeroCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(38), dp(20), dp(38), dp(20))
        background = heroBackground()
        addView(TextView(this@HomeActivity).apply {
            text = "حلقة جديدة"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(theme.accent)
            gravity = Gravity.RIGHT
        })
        addView(TextView(this@HomeActivity).apply {
            text = "أحدث محتواك"
            textSize = 36f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, 0)
        })
        addView(TextView(this@HomeActivity).apply {
            text = "الأفلام والمسلسلات والقنوات في واجهة واحدة سريعة وواضحة."
            textSize = 17f
            setTextColor(blend(Color.WHITE, theme.surface, 0.24f))
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(18))
        })
        val actions = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        actions.addView(heroButton("شاهد الآن", "hero_watch", contentIntent("series"), true), LinearLayout.LayoutParams(dp(180), dp(58)).apply { marginStart = dp(10) })
        actions.addView(heroButton("التفاصيل", "hero_details", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(160), dp(58)))
        addView(actions)
    }

    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        isFocusable = true
        isFocusableInTouchMode = true
        background = if (primary) primaryButton(false) else secondaryButton(false)
        setOnFocusChangeListener { view, focused ->
            view.background = if (primary) primaryButton(focused) else secondaryButton(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun buildContinueCard(): LinearLayout = infoCard("تابع المشاهدة", "متابعة من آخر نقطة", "استمرار ▶", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE), "continue_card")
    private fun buildLastChannelCard(): LinearLayout = infoCard("آخر قناة", "ارجع مباشرةً للبث", "استمرار ▶", Intent(this, RecentChannelsActivity::class.java), "last_channel")

    private fun infoCard(title: String, subtitle: String, buttonLabel: String, intent: Intent, key: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(24), dp(16), dp(24), dp(16))
        background = panelBackground(false)
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 13f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT; setPadding(0, dp(4), 0, dp(10)) })
        addView(TextView(this@HomeActivity).apply { text = buttonLabel; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(theme.accent); gravity = Gravity.RIGHT })
        setOnFocusChangeListener { view, focused -> view.background = panelBackground(focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key) }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun addStoryCard(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(15), dp(12), dp(15), dp(12))
            background = storyBackground(false)
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
            setOnFocusChangeListener { view, focused ->
                view.background = storyBackground(focused)
                if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                view.animate().scaleX(if (focused) theme.focusScale.coerceAtMost(1.04f) else 1f).scaleY(if (focused) theme.focusScale.coerceAtMost(1.04f) else 1f).setDuration(theme.motionMs).start()
            }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card)
        row.addView(card, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(6); marginEnd = dp(6) })
    }

    private fun buildCompactHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46))
            setBackgroundColor(theme.background)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
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
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else {
        Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)
    }

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }

    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = compactButton(key, label, intent)
        row.addView(button, if (phone) LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { bottomMargin = dp(8) }
        else LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) })
    }

    private fun compactButton(key: String, label: String, intent: Intent) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label; isAllCaps = false; textSize = if (deviceKind == DeviceClass.Kind.PHONE) 15f else 16f
        isFocusable = tv; isFocusableInTouchMode = tv; setTextColor(Color.WHITE); background = compactTile(false)
        setOnFocusChangeListener { view, focused -> if (tv) { view.background = compactTile(focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key) } }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }

    private fun sidebarBackground() = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(blend(theme.background, theme.surface, 0.72f))
        setStroke(dp(1), blend(theme.surface, theme.accent, 0.26f))
    }
    private fun sideItemBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) blend(theme.surface, theme.accent, 0.26f) else Color.TRANSPARENT)
        if (focused) setStroke(dp(1), blend(theme.accent, Color.WHITE, 0.24f))
    }
    private fun heroBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(blend(theme.background, theme.surface, 0.32f), blend(theme.background, theme.accent, 0.12f))).apply {
        cornerRadius = dp(22).toFloat()
        setStroke(dp(1), blend(theme.surface, theme.accent, 0.25f))
    }
    private fun panelBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (focused) intArrayOf(blend(theme.surface, theme.accent, 0.34f), theme.surface) else intArrayOf(blend(theme.background, theme.surface, 0.62f), theme.surface)).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.12f))
    }
    private fun storyBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(blend(theme.surface, theme.accent, 0.55f), theme.surface) else intArrayOf(theme.surface, blend(theme.background, theme.surface, 0.45f))).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) blend(theme.accent, Color.WHITE, 0.22f) else blend(theme.surface, Color.WHITE, 0.12f))
    }
    private fun primaryButton(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(if (focused) blend(theme.accent, Color.WHITE, 0.10f) else theme.accent, if (focused) blend(theme.accent, Color.BLACK, 0.04f) else blend(theme.accent, Color.BLACK, 0.14f))).apply {
        cornerRadius = dp(14).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else blend(theme.accent, Color.WHITE, 0.24f))
    }
    private fun secondaryButton(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(if (focused) blend(theme.surface, theme.accent, 0.28f) else theme.surface)
        setStroke(if (focused) dp(2) else dp(1), if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.16f))
    }
    private fun compactTile(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(if (focused) blend(theme.surface, theme.accent, 0.34f) else theme.surface); setStroke(dp(if (focused) 3 else 1), if (focused) theme.accent else blend(theme.surface, Color.WHITE, 0.12f)) }

    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; setTextColor(Color.WHITE); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(theme.accent); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun blend(a: Int, b: Int, ratio: Float): Int { val r = (Color.red(a) * (1f - ratio) + Color.red(b) * ratio).toInt(); val g = (Color.green(a) * (1f - ratio) + Color.green(b) * ratio).toInt(); val bl = (Color.blue(a) * (1f - ratio) + Color.blue(b) * ratio).toInt(); return Color.rgb(r, g, bl) }

    companion object {
        private const val SCREEN_KEY = "home"
        private val TEXT_MUTED = Color.rgb(177, 169, 191)
    }
}
