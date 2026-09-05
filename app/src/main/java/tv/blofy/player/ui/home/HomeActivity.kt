package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.HomeSnapshotStore
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
    private var heroDots: LinearLayout? = null
    private var homeFeed: LinearLayout? = null
    private var serverLabel: TextView? = null
    private var clockLabel: TextView? = null

    private val uiHandler = Handler(Looper.getMainLooper())
    private var heroCandidates: List<StreamEntity> = emptyList()
    private var heroIndex = 0

    private val clockTask = object : Runnable {
        override fun run() {
            clockLabel?.text = SimpleDateFormat("EEE  d MMM   •   h:mm a", Locale("ar", "SA")).format(Date())
            uiHandler.postDelayed(this, 30_000L)
        }
    }
    private val heroTask = object : Runnable {
        override fun run() {
            if (heroCandidates.size > 1 && !isFinishing) {
                heroIndex = (heroIndex + 1) % heroCandidates.size
                heroItem = heroCandidates[heroIndex]
                renderHero(heroCandidates[heroIndex])
                renderHeroDots()
            }
            uiHandler.postDelayed(this, HERO_ROTATION_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        // A direct intent must not bypass the same readiness check as the login screen.
        setContentView(FrameLayout(this).apply { background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background) })
        lifecycleScope.launch {
            val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull() }
            if (provider != null && !CatalogSyncState.isFullyReady(applicationContext, provider.id)) {
                startActivity(Intent(this@HomeActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
                finish()
                return@launch
            }
            showReadyHome()
        }
    }

    private fun showReadyHome() {
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvHome() else buildCompactHome())
        restoreFocus()
        warmCatalogArtwork()
        if (deviceKind == DeviceClass.Kind.TV) {
            renderSkeleton()
            loadHomeExperience()
            uiHandler.post(clockTask)
        }
    }

    override fun onDestroy() {
        uiHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (deviceKind == DeviceClass.Kind.TV && event.action == KeyEvent.ACTION_DOWN) {
            val key = actionViews.entries.firstOrNull { it.value === currentFocus }?.key
            if (key != null && event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && key.startsWith("side_")) {
                val target = when (key) {
                    "side_live" -> "hero_watch"
                    "side_movies" -> firstKey("poster_latest_") ?: "hero_movies"
                    "side_series" -> firstKey("poster_series_") ?: "series_story"
                    "side_collections" -> firstKey("poster_top_") ?: "collections"
                    "side_favorites" -> firstKey("poster_continue_") ?: "favorite_story"
                    "side_search" -> "search_story"
                    "side_settings" -> "search_story"
                    else -> null
                }
                if (target != null && actionViews[target]?.requestFocus() == true) return true
            }
            if (key != null && event.keyCode in setOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT) && !key.startsWith("side_")) {
                val row = HomeFocusPolicy.row(key)
                val siblings = if (row == null) listOf(key) else actionViews.keys.filter { HomeFocusPolicy.row(it) == row }
                val move = HomeFocusPolicy.horizontal(siblings.indexOf(key), siblings.size,
                    left = event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT, rtl = true)
                when (move) {
                    is HomeFocusPolicy.Move.Item -> {
                        val next = actionViews[siblings[move.index]]
                        if (next != null) {
                            next.requestFocus()
                            next.requestRectangleOnScreen(android.graphics.Rect(0, 0, next.width, next.height), false)
                        }
                        return true
                    }
                    HomeFocusPolicy.Move.Stay -> return true
                    HomeFocusPolicy.Move.Sidebar -> Unit
                }
                val target = when {
                    key.startsWith("poster_series_") -> "side_series"
                    key.startsWith("poster_continue_") || key.startsWith("poster_recent_") -> "side_favorites"
                    key.startsWith("poster_") || key.startsWith("top10_") -> "side_movies"
                    key in setOf("hero_watch", "live_story", "recent") -> "side_live"
                    key in setOf("hero_movies", "movie_story") -> "side_movies"
                    key == "series_story" -> "side_series"
                    key == "collections" -> "side_collections"
                    key == "favorite_story" -> "side_favorites"
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
                dao.latestHomeStreams(provider.id, 36).map { it.backdrop ?: it.icon }
            }
            if (urls.isNotEmpty()) ArtworkLoader.warmPrefetch(this@HomeActivity, urls)
        }
    }

    private data class HomeData(
        val providerId: String,
        val providerName: String,
        val heroItems: List<StreamEntity>,
        val continueWatching: List<StreamEntity>,
        val recentlyWatched: List<StreamEntity>,
        val watchStates: Map<String, WatchStateEntity>,
        val latest: List<StreamEntity>,
        val topRated: List<StreamEntity>,
        val topTen: List<StreamEntity>,
        val arabic: List<StreamEntity>,
        val ultraHd: List<StreamEntity>,
        val featured: StreamEntity?
    )

    private fun loadHomeExperience() {
        lifecycleScope.launch {
            val data = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                val latest = dao.latestHomeStreams(provider.id, 100)
                if (latest.isEmpty()) return@withContext null
                val snapshot = HomeSnapshotStore.read(applicationContext, provider.id)
                val all = snapshot?.candidateKeys?.mapNotNull { dao.stream(it) }?.takeIf { it.isNotEmpty() }
                    ?: dao.latestHomeStreams(provider.id, 320)
                val byKey = all.associateBy { it.key }
                val states = dao.watchStates(provider.id).sortedByDescending { it.updatedAt }
                val continueItems = states.filter { !it.completed && it.positionMs > 30_000L }
                    .mapNotNull { byKey[it.contentKey] }.distinctBy { it.key }.take(16)
                val recentItems = states.filter { it.positionMs > 0L }
                    .mapNotNull { byKey[it.contentKey] }.distinctBy { it.key }.take(16)
                val rated = all.sortedByDescending { ratingValue(it.rating) }
                    .filter { ratingValue(it.rating) > 0.0 }.take(24)
                val arabic = all.filter { hasArabic(it.name) || hasArabic(it.genre.orEmpty()) || it.genre.orEmpty().contains("arab", true) }.take(20)
                val ultra = all.filter { qualityBadges(it).any { badge -> badge in setOf("4K", "HDR") } }.take(20)
                val heroes = latest.filter { !it.backdrop.isNullOrBlank() }.take(6).ifEmpty { latest.take(6) }
                HomeData(
                    providerId = provider.id,
                    providerName = provider.name,
                    heroItems = heroes,
                    continueWatching = continueItems,
                    recentlyWatched = recentItems,
                    watchStates = states.associateBy { it.contentKey },
                    latest = latest.take(22),
                    topRated = rated,
                    topTen = rated.take(10).ifEmpty { latest.take(10) },
                    arabic = arabic,
                    ultraHd = ultra,
                    featured = rated.firstOrNull { !it.backdrop.isNullOrBlank() }
                        ?: latest.firstOrNull { !it.backdrop.isNullOrBlank() }
                )
            }

            if (data == null) {
                renderNoCatalogState()
                return@launch
            }

            serverLabel?.text = data.providerName.ifBlank { "BLOFY" }
            heroProviderId = data.providerId
            heroCandidates = data.heroItems
            heroIndex = 0
            heroItem = heroCandidates.firstOrNull()
            heroItem?.let(::renderHero)
            renderHeroDots()
            renderHomeFeed(data)
            uiHandler.removeCallbacks(heroTask)
            uiHandler.postDelayed(heroTask, HERO_ROTATION_MS)
            restoreDynamicFocus()
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
            qualityBadges(item).firstOrNull()?.let(::add)
            add(if (item.kind == "series") "مسلسل" else "فيلم")
        }.joinToString("   •   ")
        heroSubtitle?.text = item.plot?.takeIf(String::isNotBlank)?.take(210)
            ?: if (item.kind == "series") "مسلسل مضاف حديثًا إلى مكتبتك — اكتشف المواسم والحلقات." else "فيلم مضاف حديثًا إلى مكتبتك — جاهز للمشاهدة الآن."
        heroPrimary?.text = if (item.kind == "series") "عرض المسلسل" else "شاهد الآن"
        heroArtwork?.let {
            it.animate().cancel()
            it.alpha = .10f
            ArtworkLoader.loadPriority(it, listOf(item.backdrop, item.icon))
            it.animate().alpha(.56f).setDuration(330).start()
        }
        heroContent?.apply {
            animate().cancel()
            alpha = .78f
            translationY = dp(10).toFloat()
            animate().alpha(1f).translationY(0f).setDuration(220).start()
        }
    }

    private fun renderHeroDots() {
        val row = heroDots ?: return
        row.removeAllViews()
        heroCandidates.forEachIndexed { index, _ ->
            row.addView(View(this).apply {
                background = GradientDrawable().apply {
                    cornerRadius = dp(5).toFloat()
                    setColor(if (index == heroIndex) PURPLE_BRIGHT else 0x667B6A89)
                }
            }, LinearLayout.LayoutParams(if (index == heroIndex) dp(24) else dp(8), dp(6)).apply { marginStart = dp(5) })
        }
    }

    private fun renderSkeleton() {
        val feed = homeFeed ?: return
        val hero = feed.getChildAt(0)
        feed.removeViews(1, (feed.childCount - 1).coerceAtLeast(0))
        repeat(3) { shelfIndex ->
            feed.addView(sectionTitle(if (shelfIndex == 0) "جاري تجهيز مكتبتك" else "", if (shelfIndex == 0) "نرتب المحتوى لك…" else ""))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(5), 0, dp(12)) }
            repeat(6) {
                row.addView(View(this).apply { background = skeletonSurface() }, LinearLayout.LayoutParams(dp(148), dp(210)).apply { marginStart = dp(10) })
            }
            feed.addView(row, LinearLayout.LayoutParams(-1, dp(224)))
        }
        if (hero != null) feed.requestLayout()
    }

    private fun renderNoCatalogState() {
        val feed = homeFeed ?: return
        while (feed.childCount > 1) feed.removeViewAt(1)
        feed.addView(emptyState("مكتبتك جاهزة للعرض", "أضف أو حدّث قائمة التشغيل، وبعدها بتظهر هنا البانرات والصفوف تلقائيًا."))
    }

    private fun renderHomeFeed(data: HomeData) {
        val feed = homeFeed ?: return
        actionViews.keys.filter { it.startsWith("poster_") || it.startsWith("top10_") || it.endsWith("_story") || it == "featured" }.toList().forEach { actionViews.remove(it) }
        while (feed.childCount > 1) feed.removeViewAt(1)

        if (data.continueWatching.isNotEmpty()) {
            addShelf(feed, "تابع المشاهدة", "أكمل من آخر نقطة", "continue", data.providerId, data.continueWatching, data.watchStates)
        }
        if (data.recentlyWatched.isNotEmpty()) {
            addShelf(feed, "شاهدت مؤخرًا", "ارجع بسرعة لآخر ما فتحته", "recent", data.providerId, data.recentlyWatched)
        }
        addShelf(feed, "أضيف حديثًا", "آخر الأفلام والمسلسلات في مكتبتك", "latest", data.providerId, data.latest)
        addTopTenShelf(feed, data.providerId, data.topTen)
        if (data.topRated.isNotEmpty()) addShelf(feed, "الأعلى تقييمًا", "مختارات قوية حسب تقييم السيرفر", "top", data.providerId, data.topRated)
        data.featured?.let { addFeaturedBanner(feed, data.providerId, it) }
        addPromotionBanner(feed)

        if (data.arabic.isNotEmpty()) addShelf(feed, "مختارات عربية", "محتوى عربي في واجهة واحدة", "arabic", data.providerId, data.arabic)
        else feed.addView(compactEmpty("مختارات عربية", "ما لقينا محتوى عربي مصنف في هذه القائمة حاليًا."))

        if (data.ultraHd.isNotEmpty()) addShelf(feed, "4K • UHD", "للمحتوى عالي الجودة", "4k", data.providerId, data.ultraHd)
        else feed.addView(compactEmpty("4K • UHD", "ما فيه عناصر 4K/HDR واضحة في أسماء المحتوى حاليًا."))

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
        feed.animate().alpha(1f).translationY(0f).setDuration(280).start()
    }

    private fun addShelf(
        parent: LinearLayout,
        title: String,
        subtitle: String,
        prefix: String,
        providerId: String,
        items: List<StreamEntity>,
        states: Map<String, WatchStateEntity> = emptyMap()
    ) {
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
            row.addView(
                posterCard(providerId, item, "poster_${prefix}_${item.kind}_$index", states[item.key]),
                LinearLayout.LayoutParams(dp(154), dp(226)).apply { marginStart = dp(9); marginEnd = dp(3) }
            )
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))
        parent.addView(scroll, LinearLayout.LayoutParams(-1, dp(246)))
    }

    private fun addTopTenShelf(parent: LinearLayout, providerId: String, items: List<StreamEntity>) {
        if (items.isEmpty()) return
        parent.addView(sectionTitle("TOP 10", "الأكثر تميزًا في مكتبتك الآن"))
        val scroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER; layoutDirection = View.LAYOUT_DIRECTION_RTL; clipToPadding = false }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(4), dp(6), dp(4), dp(14)); clipChildren = false }
        items.take(10).forEachIndexed { index, item ->
            val wrap = FrameLayout(this)
            val number = TextView(this).apply {
                text = "${index + 1}"
                textSize = 64f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0xFF3B2A4D.toInt())
                gravity = Gravity.BOTTOM or Gravity.START
                includeFontPadding = false
            }
            wrap.addView(number, FrameLayout.LayoutParams(dp(60), -1, Gravity.START or Gravity.BOTTOM))
            val card = posterCard(providerId, item, "top10_${index}", null)
            wrap.addView(card, FrameLayout.LayoutParams(dp(148), dp(216), Gravity.END or Gravity.CENTER_VERTICAL))
            row.addView(wrap, LinearLayout.LayoutParams(dp(190), dp(224)).apply { marginStart = dp(8) })
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))
        parent.addView(scroll, LinearLayout.LayoutParams(-1, dp(244)))
    }

    private fun sectionTitle(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.RIGHT
        setPadding(0, dp(12), dp(4), dp(6))
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
        if (subtitle.isNotBlank()) addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11.5f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
    }

    private fun posterCard(providerId: String, item: StreamEntity, key: String, state: WatchStateEntity?) = FrameLayout(this).apply {
        id = View.generateViewId()
        isFocusable = true
        isFocusableInTouchMode = true
        isClickable = true
        background = posterSurface(false)
        clipChildren = false

        val poster = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(0xFF17101F.toInt()) }
        addView(poster, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) })
        ArtworkLoader.loadPriority(poster, listOf(item.icon, item.backdrop))

        val badges = qualityBadges(item)
        if (badges.isNotEmpty()) {
            val badgeRow = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT }
            badges.take(3).forEach { badge -> badgeRow.addView(badgeChip(badge), LinearLayout.LayoutParams(-2, dp(24)).apply { marginStart = dp(4) }) }
            addView(badgeRow, FrameLayout.LayoutParams(-2, dp(30), Gravity.TOP or Gravity.END).apply { topMargin = dp(8); marginEnd = dp(8) })
        }

        addView(View(this@HomeActivity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xED0C0812.toInt(), 0x700C0812, Color.TRANSPARENT))
        }, FrameLayout.LayoutParams(-1, dp(94), Gravity.BOTTOM))

        val text = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.BOTTOM or Gravity.RIGHT
            setPadding(dp(10), dp(8), dp(10), dp(10))
            addView(TextView(this@HomeActivity).apply { text = item.name; textSize = 12.2f; typeface = Typeface.DEFAULT_BOLD; maxLines = 2; setTextColor(Color.WHITE); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply {
                text = buildList {
                    item.year?.takeIf(String::isNotBlank)?.let(::add)
                    item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    episodeHint(item.name)?.let(::add)
                }.joinToString("  •  ")
                textSize = 10.2f; maxLines = 1; setTextColor(0xFFD9C5EC.toInt()); gravity = Gravity.RIGHT
            })
        }
        addView(text, FrameLayout.LayoutParams(-1, dp(94), Gravity.BOTTOM))

        if (state != null && state.durationMs > 0L) {
            val progress = (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
            val track = FrameLayout(this@HomeActivity).apply { background = roundedColor(0x664E3C5F, 4) }
            val fill = View(this@HomeActivity).apply { background = roundedColor(PURPLE_BRIGHT, 4) }
            track.addView(fill, FrameLayout.LayoutParams(0, dp(4)).apply { width = dp((142 * progress).toInt().coerceAtLeast(3)) })
            addView(track, FrameLayout.LayoutParams(-1, dp(4), Gravity.BOTTOM).apply { leftMargin = dp(6); rightMargin = dp(6); bottomMargin = dp(5) })
        }

        setOnFocusChangeListener { view, focused ->
            view.background = posterSurface(focused)
            if (focused) {
                FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
                heroItem = item
                heroProviderId = providerId
                val index = heroCandidates.indexOfFirst { it.key == item.key }
                if (index >= 0) heroIndex = index
                renderHero(item)
                renderHeroDots()
            }
            animateFocus(view, focused, 1.065f, 0f, dp(15).toFloat())
        }
        setOnClickListener { openDetails(providerId, item) }
        registerAction(key, this)
    }

    private fun qualityBadges(item: StreamEntity): List<String> {
        val source = "${item.name} ${item.genre.orEmpty()} ${item.extension.orEmpty()}"
        val result = mutableListOf<String>()
        if (Regex("(?i)(4k|uhd|2160p)").containsMatchIn(source)) result += "4K"
        if (Regex("(?i)(hdr|dolby\\s*vision)").containsMatchIn(source)) result += "HDR"
        if (hasArabic(item.name) || hasArabic(item.genre.orEmpty()) || source.contains("arab", true)) result += "AR"
        val added = item.addedAt ?: 0L
        val addedMs = if (added in 1..9_999_999_999L) added * 1000L else added
        if (addedMs > 0L && System.currentTimeMillis() - addedMs < 30L * 24L * 60L * 60L * 1000L) result += "NEW"
        return result.distinct()
    }

    private fun episodeHint(name: String): String? {
        val m = Regex("(?i)(?:S\\d{1,2}E|الحلقة\\s*)(\\d{1,3})").find(name) ?: return null
        return "الحلقة ${m.groupValues[1]}"
    }

    private fun badgeChip(label: String) = TextView(this).apply {
        text = label
        textSize = 9.5f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setPadding(dp(7), 0, dp(7), 0)
        background = roundedColor(if (label == "NEW") 0xFF7C3FE0.toInt() else 0xCC15101E.toInt(), 8, 0xFFB98AF1.toInt())
    }

    private fun addFeaturedBanner(parent: LinearLayout, providerId: String, item: StreamEntity) {
        parent.addView(sectionTitle("مميز لك", "اختيار بارز من مكتبتك"))
        val card = FrameLayout(this).apply {
            id = View.generateViewId(); isFocusable = true; isFocusableInTouchMode = true; isClickable = true; background = heroSurface(); clipChildren = true
            val art = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .50f }
            addView(art, FrameLayout.LayoutParams(-1, -1)); ArtworkLoader.loadPriority(art, listOf(item.backdrop, item.icon))
            addView(View(this@HomeActivity).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF5181021.toInt(), 0xB52A1738.toInt(), 0x4017101F)) }, FrameLayout.LayoutParams(-1, -1))
            val copy = LinearLayout(this@HomeActivity).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(28), dp(18), dp(28), dp(18))
                addView(TextView(this@HomeActivity).apply { text = "BLOFY FEATURED"; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT })
                addView(TextView(this@HomeActivity).apply { text = item.name; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; maxLines = 1 })
                addView(TextView(this@HomeActivity).apply { text = buildList { item.year?.let(::add); item.rating?.let { add("★ $it") }; item.genre?.substringBefore(',')?.let(::add) }.joinToString("   •   "); textSize = 12.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT })
                addView(TextView(this@HomeActivity).apply { text = item.plot?.take(150) ?: "اكتشف هذا الاختيار الآن."; textSize = 13f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(5), 0, 0) })
            }
            addView(copy, FrameLayout.LayoutParams(-1, -1))
            setOnFocusChangeListener { view, focused ->
                view.background = if (focused) featuredSurface(true) else heroSurface()
                if (focused) { FocusMemory.save(this@HomeActivity, SCREEN_KEY, "featured"); heroItem = item; heroProviderId = providerId; renderHero(item) }
                animateFocus(view, focused, 1.018f, 0f, dp(12).toFloat())
            }
            setOnClickListener { openDetails(providerId, item) }
        }
        registerAction("featured", card)
        parent.addView(card, LinearLayout.LayoutParams(-1, dp(188)).apply { topMargin = dp(4); bottomMargin = dp(12) })
    }

    private fun addPromotionBanner(parent: LinearLayout) {
        val prefs = getSharedPreferences("blofy_home_promo", MODE_PRIVATE)
        val headline = prefs.getString("headline", null)?.takeIf { it.isNotBlank() } ?: "اكتشف أكثر مع BLOFY"
        val subtitle = prefs.getString("subtitle", null)?.takeIf { it.isNotBlank() } ?: "مختارات متجددة وتجربة تلفزيون مصممة عشان توصل للمحتوى بأقل عدد من الضغطات."
        val imageUrl = prefs.getString("image_url", null)?.takeIf { it.isNotBlank() }
        val card = FrameLayout(this).apply {
            background = promoSurface()
            clipChildren = true
            if (imageUrl != null) {
                val image = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .30f }
                addView(image, FrameLayout.LayoutParams(-1, -1)); ArtworkLoader.load(image, imageUrl)
            }
            addView(LinearLayout(this@HomeActivity).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(26), dp(14), dp(26), dp(14))
                addView(TextView(this@HomeActivity).apply { text = "BLOFY SPOTLIGHT"; textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT })
                addView(TextView(this@HomeActivity).apply { text = headline; textSize = 22f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT })
                addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 12.5f; maxLines = 2; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT })
            }, FrameLayout.LayoutParams(-1, -1))
        }
        parent.addView(card, LinearLayout.LayoutParams(-1, dp(126)).apply { topMargin = dp(8); bottomMargin = dp(10) })
    }

    private fun compactEmpty(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(20), dp(14), dp(20), dp(14)); background = surface(false)
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 16f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11.5f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(80)).apply { bottomMargin = dp(10) } }

    private fun emptyState(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(30), dp(30), dp(30), dp(30)); background = surface(false)
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.CENTER })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 13f; setTextColor(TEXT_MUTED); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0) })
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(220)).apply { topMargin = dp(14) } }

    private fun openHeroItem() {
        val item = heroItem
        val providerId = heroProviderId
        if (item == null || providerId.isNullOrBlank()) { startActivity(contentIntent("live")); return }
        openDetails(providerId, item)
    }

    private fun openDetails(providerId: String, item: StreamEntity) {
        startActivity(Intent(this, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", item.key)
        })
    }

    private fun buildTvHome(): FrameLayout {
        val root = FrameLayout(this).apply { background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background); clipChildren = false; clipToPadding = false }
        val shell = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR; setPadding(dp(22), dp(18), dp(22), dp(18)); clipChildren = false; clipToPadding = false }
        root.addView(shell, FrameLayout.LayoutParams(-1, -1))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(205), -1).apply { marginEnd = dp(22) })

        val main = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; clipChildren = false; clipToPadding = false }
        shell.addView(main, LinearLayout.LayoutParams(0, -1, 1f))

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(this@HomeActivity).apply { text = "BLOFY PLAYER"; textSize = 12f; letterSpacing = .13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(0, dp(28), 1f))
        serverLabel = TextView(this@HomeActivity).apply { text = "BLOFY"; textSize = 11f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_MUTED); gravity = Gravity.CENTER }
        header.addView(serverLabel, LinearLayout.LayoutParams(dp(170), dp(28)))
        clockLabel = TextView(this@HomeActivity).apply { textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL }
        header.addView(clockLabel, LinearLayout.LayoutParams(dp(250), dp(28)))
        main.addView(header, LinearLayout.LayoutParams(-1, dp(30)))

        main.addView(TextView(this).apply { text = "وش بتشاهد اليوم؟"; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(-1, dp(44)))

        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER; clipToPadding = false; descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS }
        val feed = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; clipChildren = false; clipToPadding = false; setPadding(0, 0, 0, dp(28)) }
        homeFeed = feed
        feed.addView(buildHero(), LinearLayout.LayoutParams(-1, dp(320)).apply { bottomMargin = dp(10) })
        scroll.addView(feed, FrameLayout.LayoutParams(-1, -2))
        main.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun buildSidebar() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(14), dp(14), dp(14), dp(14)); background = surface(false); elevation = dp(5).toFloat()
        addView(ImageView(this@HomeActivity).apply { setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE; adjustViewBounds = true }, LinearLayout.LayoutParams(dp(125), dp(92)).apply { bottomMargin = dp(10) })
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
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(14), 0, dp(14), 0)
        addView(TextView(this@HomeActivity).apply { text = label; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(0, -1, 1f))
        addView(TextView(this@HomeActivity).apply { text = icon; textSize = 21f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(40), -1))
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(4) } }

    private fun sideSelected(icon: String, label: String) = sideBase(icon, label).apply { background = selectedSurface() }
    private fun sideAction(key: String, icon: String, label: String, intent: Intent) = sideBase(icon, label).apply {
        id = View.generateViewId(); isFocusable = true; isFocusableInTouchMode = true; isClickable = true; background = transparentSurface(false)
        setOnFocusChangeListener { view, focused -> view.background = transparentSurface(focused); childrenTextColor(this, focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key); animateFocus(view, focused, 1.025f, if (focused) dp(5).toFloat() else 0f, dp(8).toFloat()) }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun buildHero() = FrameLayout(this).apply {
        clipChildren = true; clipToPadding = true; background = heroSurface(); elevation = dp(5).toFloat()
        heroArtwork = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .46f }.also { addView(it, FrameLayout.LayoutParams(-1, -1)) }
        addView(View(this@HomeActivity).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF4171021.toInt(), 0xCF241532.toInt(), 0x5417101F)) }, FrameLayout.LayoutParams(-1, -1))
        val content = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(38), dp(20), dp(38), dp(20)) }
        heroContent = content
        heroKicker = TextView(this@HomeActivity).apply { text = "BLOFY PREMIUM"; textSize = 12.5f; letterSpacing = .08f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT }.also { content.addView(it) }
        heroTitle = TextView(this@HomeActivity).apply { text = "كل محتواك في مكان واحد"; textSize = 35f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(5), 0, 0) }.also { content.addView(it) }
        heroMeta = TextView(this@HomeActivity).apply { text = "أفلام   •   مسلسلات   •   بث مباشر"; textSize = 13.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFFE7D8F5.toInt()); gravity = Gravity.RIGHT; setPadding(0, dp(5), 0, 0) }.also { content.addView(it) }
        heroSubtitle = TextView(this@HomeActivity).apply { text = "بث مباشر، أفلام ومسلسلات بواجهة مصممة للتلفزيون وسريعة بالريموت."; textSize = 15.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.RIGHT; maxLines = 2; setPadding(0, dp(7), 0, dp(10)) }.also { content.addView(it) }
        heroDots = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT; setPadding(0, 0, 0, dp(8)) }.also { content.addView(it, LinearLayout.LayoutParams(-1, dp(16))) }
        val row = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.RIGHT }
        heroPrimary = actionHeroButton("شاهد الآن", "hero_watch", true) { openHeroItem() }
        row.addView(heroPrimary, LinearLayout.LayoutParams(dp(180), dp(56)).apply { marginStart = dp(10) })
        row.addView(heroButton("استكشف الأفلام", "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(185), dp(56)))
        content.addView(row); addView(content, FrameLayout.LayoutParams(-1, -1))
    }

    private fun actionHeroButton(label: String, key: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        id = View.generateViewId(); text = label; isAllCaps = false; textSize = 15.5f; typeface = Typeface.DEFAULT_BOLD; isFocusable = true; isFocusableInTouchMode = true; setTextColor(Color.WHITE); background = buttonSurface(primary, false)
        setOnFocusChangeListener { view, focused -> view.background = buttonSurface(primary, focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key); animateFocus(view, focused, 1.035f, 0f, dp(10).toFloat()) }
        setOnClickListener { action() }; registerAction(key, this)
    }
    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = actionHeroButton(label, key, primary) { startActivity(intent) }

    private fun addStory(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            id = View.generateViewId(); orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM or Gravity.RIGHT; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(dp(16), dp(13), dp(16), dp(13)); background = storySurface(false); isFocusable = true; isFocusableInTouchMode = true; isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.RIGHT })
            setOnFocusChangeListener { view, focused -> view.background = storySurface(focused); childrenTextColor(this, focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key); animateFocus(view, focused, 1.035f, 0f, dp(10).toFloat()) }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card); row.addView(card, LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(6); marginEnd = dp(6) })
    }

    private fun buildCompactHome(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = if (phone) Gravity.TOP else Gravity.CENTER_VERTICAL; setPadding(if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46), if (phone) dp(24) else dp(62), if (phone) dp(24) else dp(46)); setBackgroundColor(theme.background); layoutDirection = View.LAYOUT_DIRECTION_RTL }
        root.addView(title("BLOFY PLAYER", if (phone) 26f else 32f)); root.addView(subtitle("كل محتواك. أسرع. أبسط.", if (phone) dp(20) else dp(30)))
        val primary = actionRow(phone); addCompactAction(primary, "live", "البث المباشر", contentIntent("live")); addCompactAction(primary, "movies", "الأفلام", contentIntent("movie")); addCompactAction(primary, "series", "المسلسلات", contentIntent("series")); addCompactAction(primary, "search", "البحث", Intent(this, SearchActivity::class.java)); root.addView(primary)
        val secondary = actionRow(phone).apply { setPadding(0, if (phone) dp(8) else dp(16), 0, 0) }; addCompactAction(secondary, "recent", "آخر القنوات", Intent(this, RecentChannelsActivity::class.java)); addCompactAction(secondary, "continue", "متابعة المشاهدة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)); addCompactAction(secondary, "collections", "مختارات BLOFY", collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)); addCompactAction(secondary, "favorites", "المفضلة", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)); addCompactAction(secondary, "settings", "الإعدادات", Intent(this, SettingsActivity::class.java)); root.addView(secondary)
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
        view.animate().cancel(); view.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f).translationX(if (focused) translateX else 0f).translationZ(if (focused) elevation else dp(1).toFloat()).alpha(if (focused) 1f else .97f).setDuration(if (focused) 95 else 80).start()
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun restoreDynamicFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY) ?: return; actionViews[saved]?.post { actionViews[saved]?.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE_BRIGHT else TEXT_PRIMARY) }

    private fun roundedColor(color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color); stroke?.let { setStroke(dp(1), it) } }
    private fun surface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF69409A.toInt(), 0xFF2B193F.toInt()) else intArrayOf(0xFF241A35.toInt(), 0xFF15101E.toInt())).apply { cornerRadius = dp(19).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC092FF.toInt() else 0xFF4B385E.toInt()) }
    private fun selectedSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF8D4AE2.toInt(), 0xFF502779.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(dp(1), 0xFFC9A1F4.toInt()) }
    private fun transparentSurface(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (focused) 0xFF62328F.toInt() else Color.TRANSPARENT); if (focused) setStroke(dp(1), 0xFFB67AEF.toInt()) }
    private fun heroSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF361C4B.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(dp(1), 0xFF6F4A86.toInt()) }
    private fun promoSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF4B276A.toInt(), 0xFF20142E.toInt(), 0xFF121019.toInt())).apply { cornerRadius = dp(20).toFloat(); setStroke(dp(1), 0xFF7F56A0.toInt()) }
    private fun featuredSurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (focused) intArrayOf(0xFF482461.toInt(), 0xFF21132F.toInt()) else intArrayOf(0xFF361C4B.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(24).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) PURPLE_BRIGHT else 0xFF6F4A86.toInt()) }
    private fun posterSurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF9A55F0.toInt(), 0xFF522777.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(3) else dp(1), if (focused) 0xFFE1C5FF.toInt() else 0xFF49365A.toInt()) }
    private fun storySurface(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (focused) intArrayOf(0xFF8D4CE3.toInt(), 0xFF4E2672.toInt()) else intArrayOf(0xFF2A1D39.toInt(), 0xFF17101F.toInt())).apply { cornerRadius = dp(17).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFD3B0FA.toInt() else 0xFF4B385E.toInt()) }
    private fun buttonSurface(primary: Boolean, focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, if (primary || focused) intArrayOf(if (focused) 0xFFB05CFF.toInt() else 0xFF8D45EA.toInt(), if (focused) 0xFF7633D9.toInt() else 0xFF5922B1.toInt()) else intArrayOf(0xFF30213F.toInt(), 0xFF1A1325.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFF0DEFF.toInt() else 0xFF5D4270.toInt()) }
    private fun compactTile(focused: Boolean) = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(if (focused) 0xFF6C3BA5.toInt() else 0xFF241A35.toInt()); setStroke(dp(if (focused) 2 else 1), if (focused) PURPLE_BRIGHT else 0xFF4B385E.toInt()) }
    private fun skeletonSurface() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF2B2137.toInt(), 0xFF18131F.toInt())).apply { cornerRadius = dp(16).toFloat(); setStroke(dp(1), 0xFF43344F.toInt()) }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private const val HERO_ROTATION_MS = 8_000L
        private val PURPLE_BRIGHT = Color.rgb(178, 103, 255)
        private val TEXT_PRIMARY = Color.rgb(249, 247, 252)
        private val TEXT_SECONDARY = Color.rgb(224, 216, 232)
        private val TEXT_MUTED = Color.rgb(172, 160, 188)
    }
}
