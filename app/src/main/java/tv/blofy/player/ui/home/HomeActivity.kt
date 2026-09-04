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
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
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
    private var homeFeed: LinearLayout? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvHome() else buildCompactHome())
        restoreFocus()
        warmCatalogArtwork()
        if (deviceKind == DeviceClass.Kind.TV) loadHomeExperience()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (deviceKind == DeviceClass.Kind.TV && event.action == KeyEvent.ACTION_DOWN) {
            val key = actionViews.entries.firstOrNull { it.value === currentFocus }?.key
            if (key != null && event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && key.startsWith("side_")) {
                val target = when (key) {
                    "side_live" -> "hero_watch"
                    "side_movies" -> "hero_movies"
                    "side_series" -> firstKey("poster_series_") ?: "series_story"
                    "side_collections" -> firstKey("poster_top_") ?: "collections"
                    "side_favorites" -> "favorite_story"
                    "side_search" -> "search_story"
                    "side_settings" -> "search_story"
                    else -> null
                }
                if (target != null && actionViews[target]?.requestFocus() == true) return true
            }
            if (key != null && event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT && !key.startsWith("side_")) {
                val target = when {
                    key.startsWith("poster_series_") -> "side_series"
                    key.startsWith("poster_movie_") || key.startsWith("poster_latest_") || key.startsWith("poster_top_") || key.startsWith("poster_arabic_") || key.startsWith("poster_4k_") || key.startsWith("poster_continue_") -> "side_movies"
                    key in setOf("hero_watch", "live_story", "recent") -> "side_live"
                    key in setOf("hero_movies", "movie_story") -> "side_movies"
                    key == "series_story" -> "side_series"
                    key == "collections" -> "side_collections"
                    key in setOf("continue", "favorite_story") -> "side_favorites"
                    key == "search_story" -> "side_search"
                    else -> "side_live"
                }
                if (actionViews[target]?.requestFocus() == true) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun firstKey(prefix: String): String? = actionViews.keys.firstOrNull { it.startsWith(prefix) }

    private fun warmCatalogArtwork() {
        lifecycleScope.launch {
            val urls = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext emptyList<String?>()
                dao.latestHomeStreams(provider.id, 32).map { it.backdrop ?: it.icon }
            }
            if (urls.isNotEmpty()) ArtworkLoader.warmPrefetch(this@HomeActivity, urls)
        }
    }

    private data class HomeData(
        val providerId: String,
        val hero: StreamEntity,
        val continueWatching: List<StreamEntity>,
        val latest: List<StreamEntity>,
        val topRated: List<StreamEntity>,
        val arabic: List<StreamEntity>,
        val ultraHd: List<StreamEntity>,
        val featured: StreamEntity?
    )

    private fun loadHomeExperience() {
        lifecycleScope.launch {
            val data = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                val latest = dao.latestHomeStreams(provider.id, 80)
                if (latest.isEmpty()) return@withContext null
                val all = dao.allStreamsForProvider(provider.id).filter { it.kind == "movie" || it.kind == "series" }
                val hero = latest.firstOrNull { !it.backdrop.isNullOrBlank() }
                    ?: latest.firstOrNull { !it.icon.isNullOrBlank() }
                    ?: latest.first()
                val watched = dao.watchStates(provider.id)
                    .filter { !it.completed && it.positionMs > 30_000L }
                    .sortedByDescending { it.updatedAt }
                    .mapNotNull { state -> all.firstOrNull { it.key == state.contentKey } }
                    .take(14)
                val rated = all.sortedByDescending { ratingValue(it.rating) }.filter { ratingValue(it.rating) > 0.0 }.take(18)
                val arabic = all.filter { hasArabic(it.name) || hasArabic(it.genre.orEmpty()) || it.genre.orEmpty().contains("arab", true) }.take(18)
                val ultra = all.filter { item -> Regex("(?i)(4k|uhd|2160p|hdr|dolby\\s*vision)").containsMatchIn(item.name) }.take(18)
                HomeData(
                    providerId = provider.id,
                    hero = hero,
                    continueWatching = watched,
                    latest = latest.take(20),
                    topRated = rated,
                    arabic = arabic,
                    ultraHd = ultra,
                    featured = rated.firstOrNull { it.key != hero.key && !it.backdrop.isNullOrBlank() }
                        ?: latest.firstOrNull { it.key != hero.key && !it.backdrop.isNullOrBlank() }
                )
            } ?: return@launch

            heroProviderId = data.providerId
            heroItem = data.hero
            renderHero(data.hero)
            renderHomeFeed(data)
        }
    }

    private fun ratingValue(raw: String?): Double = raw?.replace(',', '.')?.toDoubleOrNull()?.let { if (it <= 5.0) it * 2.0 else it } ?: 0.0
    private fun hasArabic(value: String): Boolean = value.any { it in '\u0600'..'\u06FF' }

    private fun renderHero(item: StreamEntity) {
        heroKicker?.text = if (item.kind == "series") "جديد في BLOFY SERIES" else "جديد في BLOFY CINEMA"
        heroTitle?.text = item.name
        heroMeta?.text = buildList {
            item.year?.takeIf(String::isNotBlank)?.let(::add)
            item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
            item.genre?.substringBefore(',')?.trim()?.takeIf(String::isNotBlank)?.let(::add)
            add(if (item.kind == "series") "مسلسل" else "فيلم")
        }.joinToString("   •   ")
        heroSubtitle?.text = item.plot?.takeIf(String::isNotBlank)?.take(210)
            ?: if (item.kind == "series") "مسلسل مضاف حديثًا إلى مكتبتك — اكتشف المواسم والحلقات." else "فيلم مضاف حديثًا إلى مكتبتك — جاهز للمشاهدة الآن."
        heroPrimary?.text = if (item.kind == "series") "عرض المسلسل" else "شاهد الآن"
        heroArtwork?.let {
            it.alpha = 0f
            ArtworkLoader.loadPriority(it, listOf(item.backdrop, item.icon))
            it.animate().alpha(.55f).setDuration(300).start()
        }
        heroContent?.apply {
            alpha = .82f
            translationY = dp(10).toFloat()
            animate().alpha(1f).translationY(0f).setDuration(220).start()
        }
    }

    private fun renderHomeFeed(data: HomeData) {
        val feed = homeFeed ?: return
        feed.removeAllViews()
        if (data.continueWatching.isNotEmpty()) addShelf(feed, "تابع المشاهدة", "أكمل من آخر نقطة", "continue", data.providerId, data.continueWatching)
        addShelf(feed, "أضيف حديثًا", "آخر الأفلام والمسلسلات في مكتبتك", "latest", data.providerId, data.latest)
        if (data.topRated.isNotEmpty()) addShelf(feed, "الأعلى تقييمًا", "مختارات قوية حسب تقييم السيرفر", "top", data.providerId, data.topRated)
        data.featured?.let { addFeaturedBanner(feed, data.providerId, it) }
        if (data.arabic.isNotEmpty()) addShelf(feed, "مختارات عربية", "محتوى عربي في واجهة واحدة", "arabic", data.providerId, data.arabic)
        if (data.ultraHd.isNotEmpty()) addShelf(feed, "4K • UHD", "للمحتوى عالي الجودة", "4k", data.providerId, data.ultraHd)
        feed.addView(sectionTitle("اختصارات سريعة", "وصل لأقسامك بضغطة واحدة"))
        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            clipChildren = false
            setPadding(0, 0, 0, dp(22))
        }
        addStory(quick, "live_story", "البث المباشر", "قنواتك الآن", contentIntent("live"))
        addStory(quick, "movie_story", "الأفلام", "سينما", contentIntent("movie"))
        addStory(quick, "series_story", "المسلسلات", "مواسم وحلقات", contentIntent("series"))
        addStory(quick, "favorite_story", "المفضلة", "اختياراتك", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addStory(quick, "search_story", "البحث", "ابحث فورًا", Intent(this, SearchActivity::class.java))
        feed.addView(quick, LinearLayout.LayoutParams(-1, dp(118)))
        feed.alpha = 0f
        feed.translationY = dp(12).toFloat()
        feed.animate().alpha(1f).translationY(0f).setDuration(260).start()
    }

    private fun addShelf(parent: LinearLayout, title: String, subtitle: String, prefix: String, providerId: String, items: List<StreamEntity>) {
        parent.addView(sectionTitle(title, subtitle))
        val scroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipChildren = false
            clipToPadding = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(5), dp(4), dp(12))
            clipChildren = false
            clipToPadding = false
        }
        items.take(18).forEachIndexed { index, item ->
            row.addView(posterCard(providerId, item, "poster_${prefix}_${item.kind}_$index"), LinearLayout.LayoutParams(dp(154), dp(226)).apply {
                marginStart = dp(9)
                marginEnd = dp(3)
            })
        }
        scroll.addView(row, HorizontalScrollView.LayoutParams(-2, -1))
        parent.addView(scroll, LinearLayout.LayoutParams(-1, dp(246)))
    }

    private fun sectionTitle(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.RIGHT
        setPadding(0, dp(12), dp(4), dp(6))
        addView(TextView(this@HomeActivity).apply {
            text = title
            textSize = 19f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT
        })
        addView(TextView(this@HomeActivity).apply {
            text = subtitle
            textSize = 11.5f
            setTextColor(TEXT_MUTED)
            gravity = Gravity.RIGHT
        })
    }

    private fun posterCard(providerId: String, item: StreamEntity, key: String) = FrameLayout(this).apply {
        id = View.generateViewId()
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = posterSurface(false)
        clipChildren = false

        val poster = ImageView(this@HomeActivity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF17101F.toInt())
        }
        addView(poster, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) })
        ArtworkLoader.loadPriority(poster, listOf(item.icon, item.backdrop))

        addView(View(this@HomeActivity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xED0C0812.toInt(), 0x700C0812, Color.TRANSPARENT))
        }, FrameLayout.LayoutParams(-1, dp(92), Gravity.BOTTOM))

        val text = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            setPadding(dp(10), dp(8), dp(10), dp(10))
            addView(TextView(this@HomeActivity).apply {
                this.text = item.name
                textSize = 12.2f
                typeface = Typeface.DEFAULT_BOLD
                maxLines = 2
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT
            })
            addView(TextView(this@HomeActivity).apply {
                this.text = buildList {
                    item.year?.takeIf(String::isNotBlank)?.let(::add)
                    item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                }.joinToString("  •  ")
                textSize = 10.2f
                maxLines = 1
                setTextColor(0xFFD9C5EC.toInt())
                gravity = Gravity.RIGHT
            })
        }
        addView(text, FrameLayout.LayoutParams(-1, dp(92), Gravity.BOTTOM))

        setOnFocusChangeListener { view, focused ->
            view.background = posterSurface(focused)
            if (focused) {
                FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                heroItem = item
                heroProviderId = providerId
                renderHero(item)
            }
            animateFocus(view, focused, 1.065f, 0f, dp(15).toFloat())
        }
        setOnClickListener { openDetails(providerId, item) }
        registerAction(key, this)
    }

    private fun addFeaturedBanner(parent: LinearLayout, providerId: String, item: StreamEntity) {
        parent.addView(sectionTitle("مميز لك", "اختيار بارز من مكتبتك"))
        val card = FrameLayout(this).apply {
            id = View.generateViewId()
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            background = heroSurface()
            clipChildren = true
            val art = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .50f }
            addView(art, FrameLayout.LayoutParams(-1, -1))
            ArtworkLoader.loadPriority(art, listOf(item.backdrop, item.icon))
            addView(View(this@HomeActivity).apply {
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF5181021.toInt(), 0xB52A1738.toInt(), 0x4017101F))
            }, FrameLayout.LayoutParams(-1, -1))
            val copy = LinearLayout(this@HomeActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setPadding(dp(28), dp(18), dp(28), dp(18))
                addView(TextView(this@HomeActivity).apply { text = "BLOFY FEATURED"; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT })
                addView(TextView(this@HomeActivity).apply { text = item.name; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; maxLines = 1 })
                addView(TextView(this@HomeActivity).apply {
                    text = buildList { item.year?.let(::add); item.rating?.let { add("★ $it") }; item.genre?.substringBefore(',')?.let(::add) }.joinToString("   •   ")
                    textSize = 12.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT
                })
                addView(TextView(this@HomeActivity).apply { text = item.plot?.take(150) ?: "اكتشف هذا الاختيار الآن."; textSize = 13f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(5), 0, 0) })
            }
            addView(copy, FrameLayout.LayoutParams(-1, -1))
            setOnFocusChangeListener { view, focused ->
                view.background = if (focused) featuredSurface(true) else heroSurface()
                if (focused) {
                    FocusMemory.save(this@HomeActivity, SCREEN_KEY, "featured")
                    heroItem = item
                    heroProviderId = providerId
                    renderHero(item)
                }
                animateFocus(view, focused, 1.018f, 0f, dp(12).toFloat())
            }
            setOnClickListener { openDetails(providerId, item) }
        }
        registerAction("featured", card)
        parent.addView(card, LinearLayout.LayoutParams(-1, dp(188)).apply { topMargin = dp(4); bottomMargin = dp(12) })
    }

    private fun openHeroItem() {
        val item = heroItem
        val providerId = heroProviderId
        if (item == null || providerId.isNullOrBlank()) {
            startActivity(contentIntent("live"))
            return
        }
        openDetails(providerId, item)
    }

    private fun openDetails(providerId: String, item: StreamEntity) {
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
        }, LinearLayout.LayoutParams(-1, dp(28)))
        main.addView(TextView(this).apply {
            text = "وش بتشاهد اليوم؟"
            textSize = 27f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(TEXT_PRIMARY)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(-1, dp(44)))

        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
            descendantFocusability = View.FOCUS_AFTER_DESCENDANTS
        }
        val feed = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            clipToPadding = false
            setPadding(0, 0, 0, dp(28))
        }
        homeFeed = feed
        feed.addView(buildHero(), LinearLayout.LayoutParams(-1, dp(320)).apply { bottomMargin = dp(10) })
        scroll.addView(feed, ScrollView.LayoutParams(-1, -2))
        main.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
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
        heroArtwork = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .46f }
            .also { addView(it, FrameLayout.LayoutParams(-1, -1)) }
        addView(View(this@HomeActivity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF4171021.toInt(), 0xCF241532.toInt(), 0x5417101F))
        }, FrameLayout.LayoutParams(-1, -1))
        val content = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(38), dp(20), dp(38), dp(20))
        }
        heroContent = content
        heroKicker = TextView(this@HomeActivity).apply { text = "BLOFY PREMIUM"; textSize = 12.5f; letterSpacing = .08f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT }.also { content.addView(it) }
        heroTitle = TextView(this@HomeActivity).apply { text = "كل محتواك في مكان واحد"; textSize = 35f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(5), 0, 0) }.also { content.addView(it) }
        heroMeta = TextView(this@HomeActivity).apply { text = "أفلام   •   مسلسلات   •   بث مباشر"; textSize = 13.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFFE7D8F5.toInt()); gravity = Gravity.RIGHT; setPadding(0, dp(5), 0, 0) }.also { content.addView(it) }
        heroSubtitle = TextView(this@HomeActivity).apply { text = "بث مباشر، أفلام ومسلسلات بواجهة مصممة للتلفزيون وسريعة بالريموت."; textSize = 15.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(7), 0, dp(13)) }.also { content.addView(it) }
        val row = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT }
        heroPrimary = actionHeroButton("شاهد الآن", "hero_watch", true) { openHeroItem() }
        row.addView(heroPrimary, LinearLayout.LayoutParams(dp(180), dp(56)).apply { marginStart = dp(10) })
        row.addView(heroButton("استكشف الأفلام", "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(185), dp(56)))
        content.addView(row)
        addView(content, FrameLayout.LayoutParams(-1, -1))
    }

    private fun actionHeroButton(label: String, key: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        id = View.generateViewId(); text = label; isAllCaps = false; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD
        isFocusable = true; isFocusableInTouchMode = true; setTextColor(Color.WHITE); background = buttonSurface(primary, false)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonSurface(primary, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            animateFocus(view, focused, 1.035f, 0f, dp(10).toFloat())
        }
        setOnClickListener { action() }
        registerAction(key, this)
    }

    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = actionHeroButton(label, key, primary) { startActivity(intent) }

    private fun addStory(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            id = View.generateViewId(); orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16), dp(13), dp(16), dp(13)); background = storySurface(false)
            isFocusable = true; isFocusableInTouchMode = true; isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
            setOnFocusChangeListener { view, focused ->
                view.background = storySurface(focused); childrenTextColor(this, focused)
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
            orientation = LinearLayout.VERTICAL; gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL
            setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46))
            setBackgroundColor(theme.background); layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        root.addView(title("BLOFY PLAYER", if (phone) 26f else 32f)); root.addView(subtitle("كل محتواك. أسرع. أبسط.", if (phone) dp(20) else dp(30)))
        val primary = actionRow(phone)
        addCompactAction(primary, "live", "البث المباشر", contentIntent("live")); addCompactAction(primary, "movies", "الأفلام", contentIntent("movie")); addCompactAction(primary, "series", "المسلسلات", contentIntent("series")); addCompactAction(primary, "search", "البحث", Intent(this, SearchActivity::class.java)); root.addView(primary)
        val secondary = actionRow(phone).apply { setPadding(0, if (phone) dp(8) else dp(16), 0, 0) }
        addCompactAction(secondary, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java)); addCompactAction(secondary, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)); addCompactAction(secondary, "collections", "مختارات BLOFY", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)); addCompactAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)); addCompactAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java)); root.addView(secondary)
        return root
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)

    private fun collectionIntent(mode: String): Intent = Intent(this, SmartCollectionsActivity::class.java).putExtra(SmartCollectionsActivity.EXTRA_MODE, mode)
    private fun actionRow(phone: Boolean) = LinearLayout(this).apply { orientation = if (phone) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
    private fun addCompactAction(row: LinearLayout, key: String, label: String, intent: Intent) {
        val phone = deviceKind == DeviceClass.Kind.PHONE; val button = compactButton(key, label, intent)
        row.addView(button, if (phone) LinearLayout.LayoutParams(-1, dp(72)).apply { bottomMargin = dp(8) } else LinearLayout.LayoutParams(0, dp(112), 1f).apply { marginEnd = dp(14) })
    }
    private fun compactButton(key: String, label: String, intent: Intent) = Button(this).apply {
        text = label; isAllCaps = false; textSize = if (deviceKind == DeviceClass.Kind.PHONE) 15f else 16f; setTextColor(TEXT_PRIMARY); background = compactTile(false)
        setOnFocusChangeListener { view, focused -> setTextColor(Color.WHITE); view.background = compactTile(focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key); animateFocus(view, focused, 1.025f, 0f, dp(7).toFloat()) }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun animateFocus(view: View, focused: Boolean, scale: Float, translateX: Float, elevation: Float) {
        view.animate().cancel(); view.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f)
            .translationX(if (focused) translateX else 0f).translationZ(if (focused) elevation else dp(1).toFloat())
            .alpha(if (focused) 1f else .97f).setDuration(if (focused) 95 else 80).start()
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE_BRIGHT else TEXT_PRIMARY) }

    private fun surface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF69409A.toInt(), 0xFF2B193F.toInt()) else intArrayOf(0xFF241A35.toInt(), 0xFF15101E.toInt())).apply { cornerRadius = dp(19).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC092FF.toInt() else 0xFF4B385E.toInt()) }
    private fun selectedSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF8D4AE2.toInt(), 0xFF502779.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(dp(1), 0xFFC9A1F4.toInt()) }
    private fun transparentSurface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (focused) 0xFF62328F.toInt() else Color.TRANSPARENT); if (focused) setStroke(dp(1), 0xFFB67AEF.toInt()) }
    private fun heroSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF361C4B.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(dp(1), 0xFF6F4A86.toInt()) }
    private fun featuredSurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (focused) intArrayOf(0xFF482461.toInt(), 0xFF21132F.toInt()) else intArrayOf(0xFF361C4B.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE_BRIGHT else 0xFF6F4A86.toInt()) }
    private fun posterSurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF9A55F0.toInt(), 0xFF522777.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(3) else dp(1), if (focused) 0xFFE1C5FF.toInt() else 0xFF49365A.toInt()) }
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
