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
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
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

    private var heroItem: StreamEntity? = null
    private var heroProviderId: String? = null
    private var heroArtwork: ImageView? = null
    private var heroKicker: TextView? = null
    private var heroTitle: TextView? = null
    private var heroMeta: TextView? = null
    private var heroSubtitle: TextView? = null
    private var heroPrimary: Button? = null
    private var heroContent: View? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvHome() else buildCompactHome())
        restoreFocus()
        warmCatalogArtwork()
        if (deviceKind == DeviceClass.Kind.TV) loadDynamicHero()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (deviceKind == DeviceClass.Kind.TV && event.action == KeyEvent.ACTION_DOWN) {
            val key = actionViews.entries.firstOrNull { it.value === currentFocus }?.key
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
                dao.latestHomeStreams(provider.id, 18).map { it.backdrop ?: it.icon }
            }
            if (urls.isNotEmpty()) ArtworkLoader.warmPrefetch(this@HomeActivity, urls)
        }
    }

    private fun loadDynamicHero() {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                val candidates = dao.latestHomeStreams(provider.id, 24)
                val selected = candidates.firstOrNull { !it.backdrop.isNullOrBlank() }
                    ?: candidates.firstOrNull { !it.icon.isNullOrBlank() }
                    ?: candidates.firstOrNull()
                    ?: return@withContext null
                provider.id to selected
            } ?: return@launch
            heroProviderId = result.first
            heroItem = result.second
            renderHero(result.second)
        }
    }

    private fun renderHero(item: StreamEntity) {
        heroKicker?.text = if (item.kind == "series") "جديد في BLOFY SERIES" else "جديد في BLOFY CINEMA"
        heroTitle?.text = item.name
        heroMeta?.text = buildList {
            item.year?.takeIf(String::isNotBlank)?.let(::add)
            item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
            item.genre?.substringBefore(',')?.trim()?.takeIf(String::isNotBlank)?.let(::add)
            add(if (item.kind == "series") "مسلسل" else "فيلم")
        }.joinToString("   •   ")
        heroSubtitle?.text = item.plot?.takeIf(String::isNotBlank)?.take(190)
            ?: if (item.kind == "series") "مسلسل مضاف حديثًا إلى مكتبتك — اكتشف المواسم والحلقات." else "فيلم مضاف حديثًا إلى مكتبتك — جاهز للمشاهدة الآن."
        heroPrimary?.text = if (item.kind == "series") "عرض المسلسل" else "شاهد الآن"
        heroArtwork?.let {
            it.alpha = 0f
            ArtworkLoader.loadPriority(it, listOf(item.backdrop, item.icon))
            it.animate().alpha(.52f).setDuration(260).start()
        }
        heroContent?.apply {
            alpha = .82f
            translationY = dp(8).toFloat()
            animate().alpha(1f).translationY(0f).setDuration(210).start()
        }
    }

    private fun openHeroItem() {
        val item = heroItem
        val providerId = heroProviderId
        if (item == null || providerId.isNullOrBlank()) {
            startActivity(contentIntent("live"))
            return
        }
        startActivity(Intent(this, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", item.key)
        })
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
        root.addView(shell, FrameLayout.LayoutParams(-1, -1))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(205), -1).apply { marginEnd = dp(22) })

        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
        }
        shell.addView(main, LinearLayout.LayoutParams(0, -1, 1f))

        main.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 12f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(PURPLE_BRIGHT)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(-1, dp(30)))

        main.addView(TextView(this).apply {
            text = "وش بتشاهد اليوم؟"
            textSize = 27f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(-1, dp(48)))

        main.addView(buildHero(), LinearLayout.LayoutParams(-1, 0, 1.48f))

        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(12), 0, dp(12))
            clipChildren = false
        }
        quick.addView(infoCard("تابع المشاهدة", "أكمل من آخر نقطة", "continue", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)), LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(10) })
        quick.addView(infoCard("مختارات BLOFY", "الأعلى تقييمًا و4K وعربي", "collections", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)), LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(10) })
        quick.addView(infoCard("آخر القنوات", "ارجع للبث فورًا", "recent", Intent(this, RecentChannelsActivity::class.java)), LinearLayout.LayoutParams(0, -1, 1f))
        main.addView(quick, LinearLayout.LayoutParams(-1, 0, .72f))

        main.addView(TextView(this).apply {
            text = "استكشف BLOFY"
            textSize = 18.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(-1, dp(38)))

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
        main.addView(cards, LinearLayout.LayoutParams(-1, 0, .62f))
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
        addView(TextView(this@HomeActivity).apply {
            text = label; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, -1, 1f))
        addView(TextView(this@HomeActivity).apply {
            text = icon; textSize = 21f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(40), -1))
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(4) } }

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
            animateFocus(view, focused, 1.025f, if (focused) dp(5).toFloat() else 0f, dp(8).toFloat())
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun buildHero() = FrameLayout(this).apply {
        clipChildren = true
        clipToPadding = true
        background = heroSurface()
        elevation = dp(5).toFloat()

        heroArtwork = ImageView(this@HomeActivity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = .46f
        }.also { addView(it, FrameLayout.LayoutParams(-1, -1)) }

        addView(View(this@HomeActivity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF2171021.toInt(), 0xCA241532.toInt(), 0x5C17101F))
        }, FrameLayout.LayoutParams(-1, -1))

        val content = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(38), dp(20), dp(38), dp(20))
        }
        heroContent = content

        heroKicker = TextView(this@HomeActivity).apply {
            text = "BLOFY PREMIUM"; textSize = 12.5f; letterSpacing = .08f
            typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT
        }.also { content.addView(it) }

        heroTitle = TextView(this@HomeActivity).apply {
            text = "كل محتواك في مكان واحد"; textSize = 35f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(5), 0, 0)
        }.also { content.addView(it) }

        heroMeta = TextView(this@HomeActivity).apply {
            text = "أفلام   •   مسلسلات   •   بث مباشر"; textSize = 13.5f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFE7D8F5.toInt()); gravity = Gravity.RIGHT; setPadding(0, dp(5), 0, 0)
        }.also { content.addView(it) }

        heroSubtitle = TextView(this@HomeActivity).apply {
            text = "بث مباشر، أفلام ومسلسلات بواجهة مصممة للتلفزيون وسريعة بالريموت."
            textSize = 15.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; maxLines = 2
            setPadding(0, dp(7), 0, dp(13))
        }.also { content.addView(it) }

        val row = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT
        }
        heroPrimary = actionHeroButton("شاهد الآن", "hero_watch", true) { openHeroItem() }
        row.addView(heroPrimary, LinearLayout.LayoutParams(dp(180), dp(56)).apply { marginStart = dp(10) })
        row.addView(heroButton("استكشف الأفلام", "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(185), dp(56)))
        content.addView(row)
        addView(content, FrameLayout.LayoutParams(-1, -1))
    }

    private fun actionHeroButton(label: String, key: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
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
            animateFocus(view, focused, 1.035f, 0f, dp(10).toFloat())
        }
        setOnClickListener { action() }
        registerAction(key, this)
    }

    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = actionHeroButton(label, key, primary) { startActivity(intent) }

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
            animateFocus(view, focused, 1.025f, 0f, dp(8).toFloat())
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
                animateFocus(view, focused, 1.035f, 0f, dp(10).toFloat())
            }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card)
        row.addView(card, LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(6); marginEnd = dp(6) })
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

    private fun collectionIntent(mode: String): Intent = Intent(this, SmartCollectionsActivity::class.java).putExtra(SmartCollectionsActivity.EXTRA_MODE, mode)
    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }

    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val button = compactButton(key, label, intent)
        row.addView(button, if (phone) LinearLayout.LayoutParams(-1, dp(72)).apply { bottomMargin = dp(8) } else LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) })
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
            animateFocus(view, focused, 1.025f, 0f, dp(7).toFloat())
        }
        setOnClickListener { startActivity(intent) }
        registerAction(key, this)
    }

    private fun animateFocus(view: View, focused: Boolean, scale: Float, translateX: Float, elevation: Float) {
        view.animate().cancel()
        view.animate()
            .scaleX(if (focused) scale else 1f)
            .scaleY(if (focused) scale else 1f)
            .translationX(if (focused) translateX else 0f)
            .translationZ(if (focused) elevation else dp(1).toFloat())
            .alpha(if (focused) 1f else .96f)
            .setDuration(if (focused) 95 else 80)
            .start()
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE_BRIGHT else TEXT_PRIMARY) }

    private fun surface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF69409A.toInt(), 0xFF2B193F.toInt()) else intArrayOf(0xFF241A35.toInt(), 0xFF15101E.toInt())).apply { cornerRadius = dp(19).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC092FF.toInt() else 0xFF4B385E.toInt()) }
    private fun selectedSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF8D4AE2.toInt(), 0xFF502779.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(dp(1), 0xFFC9A1F4.toInt()) }
    private fun transparentSurface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (focused) 0xFF62328F.toInt() else Color.TRANSPARENT); if (focused) setStroke(dp(1), 0xFFB67AEF.toInt()) }
    private fun heroSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF361C4B.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(dp(1), 0xFF6F4A86.toInt()) }
    private fun storySurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF8D4CE3.toInt(), 0xFF4E2672.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(17).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFD3B0FA.toInt() else 0xFF4B385E.toInt()) }
    private fun buttonSurface(primary: Boolean, focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (primary || focused) intArrayOf(if (focused) 0xFFB05CFF.toInt() else 0xFF8D45EA.toInt(), if (focused) 0xFF7633D9.toInt() else 0xFF5922B1.toInt()) else intArrayOf(0xFF30213F.toInt(), 0xFF1A1325.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFF0DEFF.toInt() else 0xFF5D4270.toInt()) }
    private fun compactTile(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(if (focused) 0xFF6C3BA5.toInt() else 0xFF241A35.toInt()); setStroke(dp(if (focused) 2 else 1), if (focused) PURPLE_BRIGHT else 0xFF4B385E.toInt()) }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private val PURPLE_BRIGHT = Color.rgb(178, 103, 255)
        private val TEXT_PRIMARY = Color.rgb(249, 247, 252)
        private val TEXT_SECONDARY = Color.rgb(224, 216, 232)
        private val TEXT_MUTED = Color.rgb(172, 160, 188)
    }
}
