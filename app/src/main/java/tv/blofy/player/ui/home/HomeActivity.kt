package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
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
        warmCatalogArtwork()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (deviceKind == DeviceClass.Kind.TV && event.action == KeyEvent.ACTION_DOWN) {
            val focused = currentFocus
            val key = actionViews.entries.firstOrNull { it.value === focused }?.key
            if (key != null && event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && key.startsWith("side_")) {
                val target = when (key) {
                    "side_live" -> "hero_watch"
                    "side_movies" -> "hero_movies"
                    "side_series" -> "series_story"
                    "side_collections" -> "collections"
                    "side_favorites" -> "favorite_story"
                    "side_search" -> "search_story"
                    "side_settings" -> "search_story"
                    else -> null
                }
                if (target != null && actionViews[target]?.requestFocus() == true) return true
            }
            if (key != null && event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT && !key.startsWith("side_")) {
                val target = when (key) {
                    "hero_watch", "live_story", "recent" -> "side_live"
                    "hero_movies", "movie_story" -> "side_movies"
                    "series_story" -> "side_series"
                    "collections" -> "side_collections"
                    "continue", "favorite_story" -> "side_favorites"
                    "search_story" -> "side_search"
                    else -> "side_live"
                }
                if (actionViews[target]?.requestFocus() == true) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun warmCatalogArtwork() {
        lifecycleScope.launch {
            val urls = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext emptyList<String?>()
                val movies = dao.catalogPageAfterAll(provider.id, "movie", 0L, 10)
                val series = dao.catalogPageAfterAll(provider.id, "series", 0L, 10)
                (movies + series).map { it.icon ?: it.backdrop }
            }
            if (urls.isNotEmpty()) ArtworkLoader.warmPrefetch(this@HomeActivity, urls)
        }
    }

    private fun buildTvHome(): FrameLayout {
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(22), dp(18), dp(22), dp(18))
            clipChildren = false
            clipToPadding = false
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(205), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(22) })
        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        main.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 12f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(PURPLE_BRIGHT)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)))
        main.addView(TextView(this).apply {
            text = "وش بتشاهد اليوم؟"
            textSize = 27f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))
        main.addView(buildHero(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.48f))

        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(12), 0, dp(12))
            clipChildren = false
        }
        quick.addView(
            infoCard("تابع المشاهدة", "أكمل من آخر نقطة", "continue", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)),
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(10) }
        )
        quick.addView(
            infoCard("مختارات BLOFY", "الأعلى تقييمًا و4K وعربي", "collections", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)),
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(10) }
        )
        quick.addView(
            infoCard("آخر القنوات", "ارجع للبث فورًا", "recent", Intent(this, RecentChannelsActivity::class.java)),
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
        )
        main.addView(quick, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, .72f))

        main.addView(TextView(this).apply {
            text = "استكشف BLOFY"
            textSize = 18.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)))
        val cards = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            clipChildren = false
        }
        addStory(cards, "live_story", "البث المباشر", "قنواتك الآن", contentIntent("live"))
        addStory(cards, "movie_story", "الأفلام", "سينما", contentIntent("movie"))
        addStory(cards, "series_story", "المسلسلات", "مواسم وحلقات", contentIntent("series"))
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
        background = surface(false)
        elevation = dp(5).toFloat()
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(125), dp(92)).apply { bottomMargin = dp(10) })
        addView(sideSelected("⌂", "الرئيسية"))
        addView(sideAction("side_live", "◉", "بث مباشر", contentIntent("live")))
        addView(sideAction("side_movies", "▣", "الأفلام", contentIntent("movie")))
        addView(sideAction("side_series", "▤", "المسلسلات", contentIntent("series")))
        addView(sideAction("side_collections", "✦", "مختارات", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)))
        addView(sideAction("side_favorites", "♡", "المفضلة", Intent(this@HomeActivity, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)))
        addView(sideAction("side_search", "⌕", "بحث", Intent(this@HomeActivity, SearchActivity::class.java)))
        addView(sideAction("side_settings", "⚙", "الإعدادات", Intent(this@HomeActivity, SettingsActivity::class.java)))
    }

    private fun sideBase(icon: String, label: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(14), 0, dp(14), 0)
        addView(TextView(this@HomeActivity).apply { text = label; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        addView(TextView(this@HomeActivity).apply { text = icon; textSize = 21f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(40), LinearLayout.LayoutParams.MATCH_PARENT))
    }.also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { bottomMargin = dp(4) } }

    private fun sideSelected(icon: String, label: String) = sideBase(icon, label).apply { background = selectedSurface() }

    private fun sideAction(key: String, icon: String, label: String, intent: Intent) = sideBase(icon, label).apply {
        id = View.generateViewId()
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = transparentSurface(false)
        setOnFocusChangeListener { view, focused ->
            view.background = transparentSurface(focused)
            childrenTextColor(this, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.02f else 1f).scaleY(if (focused) 1.02f else 1f).translationZ(if (focused) dp(8).toFloat() else 1f).setDuration(72).start()
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun buildHero() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(38), dp(24), dp(38), dp(24))
        background = heroSurface()
        elevation = dp(5).toFloat()
        addView(TextView(this@HomeActivity).apply { text = "BLOFY PREMIUM"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = "كل محتواك في مكان واحد"; textSize = 38f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; setPadding(0, dp(7), 0, 0) })
        addView(TextView(this@HomeActivity).apply { text = "بث مباشر، أفلام ومسلسلات بواجهة مصممة للتلفزيون وسريعة بالريموت."; textSize = 17f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; setPadding(0, dp(8), 0, dp(20)) })
        val row = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT }
        row.addView(heroButton("شاهد البث", "hero_watch", contentIntent("live"), true), LinearLayout.LayoutParams(dp(180), dp(60)).apply { marginStart = dp(10) })
        row.addView(heroButton("استكشف الأفلام", "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(185), dp(60)))
        addView(row)
    }

    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = Button(this).apply {
        id = View.generateViewId()
        text = label
        isAllCaps = false
        textSize = 15.5f
        typeface = Typeface.DEFAULT_BOLD
        isFocusable = true
        isFocusableInTouchMode = true
        setTextColor(Color.WHITE)
        background = buttonSurface(primary, false)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonSurface(primary, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.02f else 1f).scaleY(if (focused) 1.02f else 1f).setDuration(72).start()
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun infoCard(title: String, subtitle: String, key: String, intent: Intent) = LinearLayout(this).apply {
        id = View.generateViewId()
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(20), dp(14), dp(20), dp(14))
        background = surface(false)
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 18.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 12.2f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT; setPadding(0, dp(4), 0, dp(8)) })
        addView(TextView(this@HomeActivity).apply { text = "استمرار  ←"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT })
        setOnFocusChangeListener { view, focused ->
            view.background = surface(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).setDuration(68).start()
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun addStory(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(16), dp(13), dp(16), dp(13))
            background = storySurface(false)
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
            setOnFocusChangeListener { view, focused ->
                view.background = storySurface(focused)
                childrenTextColor(this, focused)
                if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).translationZ(if (focused) dp(9).toFloat() else 1f).setDuration(72).start()
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
        addCompactAction(secondary, "collections", "مختارات BLOFY", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED))
        addCompactAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addCompactAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java))
        root.addView(secondary)
        return root
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)

    private fun collectionIntent(mode: String): Intent = Intent(this, SmartCollectionsActivity::class.java)
        .putExtra(SmartCollectionsActivity.EXTRA_MODE, mode)

    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }

    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = compactButton(key, label, intent)
        row.addView(button, if (phone) LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(72)).apply { bottomMargin = dp(8) } else LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) })
    }

    private fun compactButton(key: String, label: String, intent: Intent) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = if (deviceKind == DeviceClass.Kind.PHONE) 15f else 16f
        setTextColor(TEXT_PRIMARY)
        background = compactTile(false)
        setOnFocusChangeListener { view, focused ->
            setTextColor(Color.WHITE)
            view.background = compactTile(focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE_BRIGHT else TEXT_PRIMARY) }
    private fun surface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF633A8D.toInt(), 0xFF2A183D.toInt()) else intArrayOf(0xFF241A35.toInt(), 0xFF15101E.toInt())).apply { cornerRadius = dp(18).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE_BRIGHT else 0xFF4B385E.toInt()) }
    private fun selectedSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF7D3FCE.toInt(), 0xFF4A246F.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(dp(1), 0xFFB887F0.toInt()) }
    private fun transparentSurface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (focused) 0xFF5B2D86.toInt() else Color.TRANSPARENT); if (focused) setStroke(dp(1), 0xFF9D69D0.toInt()) }
    private fun heroSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF321A46.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(22).toFloat(); setStroke(dp(1), 0xFF624178.toInt()) }
    private fun storySurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF8245D8.toInt(), 0xFF4B246D.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(16).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC49AF2.toInt() else 0xFF4B385E.toInt()) }
    private fun buttonSurface(primary: Boolean, focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (primary || focused) intArrayOf(if (focused) 0xFFA653FF.toInt() else 0xFF843FE6.toInt(), if (focused) 0xFF7130D2.toInt() else 0xFF5720AD.toInt()) else intArrayOf(0xFF30213F.toInt(), 0xFF1A1325.toInt())).apply { cornerRadius = dp(14).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFE8D3FF.toInt() else 0xFF563C69.toInt()) }
    private fun compactTile(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(if (focused) 0xFF63379B.toInt() else 0xFF241A35.toInt()); setStroke(dp(if (focused) 2 else 1), if (focused) PURPLE_BRIGHT else 0xFF4B385E.toInt()) }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private val PURPLE_BRIGHT = Color.rgb(169, 91, 255)
        private val TEXT_PRIMARY = Color.rgb(249, 247, 252)
        private val TEXT_SECONDARY = Color.rgb(221, 214, 230)
        private val TEXT_MUTED = Color.rgb(168, 157, 183)
    }
}
