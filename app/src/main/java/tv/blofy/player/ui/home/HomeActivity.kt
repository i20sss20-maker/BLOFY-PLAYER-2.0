package tv.blofy.player.ui.home

import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.content.res.ColorStateList
import tv.blofy.player.ui.common.CinemaStyle
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
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
import androidx.core.os.ConfigurationCompat
import androidx.core.view.doOnLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.HomeSnapshotStore
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.catalog.SmartCollectionsActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.mobile.MobileContentActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class HomeActivity : AppCompatActivity() {
    private lateinit var deviceKind: DeviceClass.Kind
    private val uiDirection get() = resources.configuration.layoutDirection
    private val remote get() = !::deviceKind.isInitialized || deviceKind == DeviceClass.Kind.TV
    private val layoutSpec get() = HomeLayoutSpec(
        resources.configuration.screenWidthDp.coerceAtLeast(320),
        resources.configuration.screenHeightDp.coerceAtLeast(320), remote)
    private val compactTv get() = resources.configuration.screenHeightDp <= 600
    private val railRowHeight get() = layoutSpec.railRowHeight
    private val posterWidth get() = layoutSpec.posterWidth
    private val posterHeight get() = posterWidth * 3 / 2
    private var firstAction: View? = null
    private val actionViews = linkedMapOf<String, View>()
    private var homeFocusController: HomeFocusController? = null

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

    private var homeResumed = false
    private var displayedHomeData: HomeData? = null
    private val historyObserver by lazy {
        HomeHistoryObserver(lifecycleScope, changes = {
            BlofyDatabase.get(applicationContext).invalidationTracker.createFlow("watch_state")
        }, refresh = ::refreshHomeHistory)
    }
    private val refreshScheduler = HomeRefreshScheduler(
        uiHandler, 30_000L, HERO_ROTATION_MS,
        refreshClock = {
            clockLabel?.text = SimpleDateFormat("EEE  d MMM   •   h:mm a",
                ConfigurationCompat.getLocales(resources.configuration)[0] ?: Locale.getDefault()).format(Date())
        },
        rotateHero = {
            if (remote && heroCandidates.size > 1 && !isFinishing && heroContent?.hasFocus() != true) {
                heroIndex = (heroIndex + 1) % heroCandidates.size
                heroItem = heroCandidates[heroIndex]
                renderHero(heroCandidates[heroIndex])
                renderHeroDots()
            }
        },
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        deviceKind = DeviceClass.detect(this)
        // A direct intent must not bypass the same readiness check as the login screen.
        setContentView(FrameLayout(this).apply { background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background) })
        lifecycleScope.launch {
            val provider = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().providersStored().first().firstOrNull() }
            if (provider != null && !CatalogSyncState.isEntryReady(applicationContext, provider.id)) {
                startActivity(Intent(this@HomeActivity, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
                finish()
                return@launch
            }
            showReadyHome()
        }
    }

    private fun showReadyHome() {
        val root = if (layoutSpec.compact) buildCompactHome() else buildTvHome()
        setContentView(root)
        if (!remote) {
            ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
            ViewCompat.requestApplyInsets(root)
        }
        if (deviceKind == DeviceClass.Kind.TV) {
            homeFocusController?.dispose()
            homeFocusController = HomeFocusController(
                findViewById(android.R.id.content),
                checkNotNull(actionViews["side_live"]?.parent as? android.view.ViewGroup),
                checkNotNull(homeFeed),
            ) { actionViews }
        }
        restoreFocus()
        warmCatalogArtwork()
        renderSkeleton()
        loadHomeExperience()
        if (homeResumed) {
            refreshScheduler.start()
            historyObserver.start()
        }
    }

    override fun onResume() {
        super.onResume()
        homeResumed = true
        if (homeFeed != null) {
            refreshScheduler.start()
            historyObserver.start()
        }
    }

    override fun onPause() {
        homeResumed = false
        refreshScheduler.stop()
        historyObserver.stop()
        homeFocusController?.resetPress()
        super.onPause()
    }

    override fun onDestroy() {
        homeFocusController?.dispose()
        homeFocusController = null
        refreshScheduler.stop()
        historyObserver.stop()
        uiHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (homeFocusController?.handle(event) == true) return true
        return super.dispatchKeyEvent(event)
    }

    private fun warmCatalogArtwork() {
        lifecycleScope.launch {
            val urls = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providersStored().first().firstOrNull() ?: return@withContext emptyList<String?>()
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
                // Home uses identity/name only; displaying local rows must not wait for Keystore.
                val provider = dao.providersStored().first().firstOrNull() ?: return@withContext null
                val latest = dao.latestHomeStreams(provider.id, 100)
                if (latest.isEmpty()) return@withContext null
                val snapshot = HomeSnapshotStore.read(applicationContext, provider.id)
                val all = snapshot?.candidateKeys?.mapNotNull { dao.stream(it) }?.takeIf { it.isNotEmpty() }
                    ?: dao.latestHomeStreams(provider.id, 320)
                val history = HomeWatchHistory.load(dao, provider.id)
                val rated = all.sortedByDescending { ratingValue(it.rating) }
                    .filter { ratingValue(it.rating) > 0.0 }.take(24)
                val arabic = all.filter { hasArabic(it.name) || hasArabic(it.genre.orEmpty()) || it.genre.orEmpty().contains("arab", true) }.take(20)
                val ultra = all.filter { qualityBadges(it).any { badge -> badge in setOf("4K", "HDR") } }.take(20)
                val heroes = latest.filter { !it.backdrop.isNullOrBlank() }.take(6).ifEmpty { latest.take(6) }
                HomeData(
                    providerId = provider.id,
                    providerName = provider.name,
                    heroItems = heroes,
                    continueWatching = history.continueItems,
                    recentlyWatched = history.recentItems,
                    watchStates = history.watchStates,
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
                displayedHomeData = null
                renderNoCatalogState()
                return@launch
            }

            displayedHomeData = data
            serverLabel?.text = data.providerName.ifBlank { "BLOFY" }
            heroProviderId = data.providerId
            heroCandidates = data.heroItems
            heroIndex = 0
            heroItem = heroCandidates.firstOrNull()
            heroItem?.let(::renderHero)
            renderHeroDots()
            renderHomeFeed(data)
            refreshScheduler.restartHero()
            restoreDynamicFocus()
        }
    }

    private suspend fun refreshHomeHistory() {
        val previous = displayedHomeData ?: return
        val history = withContext(Dispatchers.IO) {
            HomeWatchHistory.load(BlofyDatabase.get(applicationContext).dao(), previous.providerId)
        }
        if (displayedHomeData !== previous || !homeResumed) return
        if (history.continueItems == previous.continueWatching && history.recentItems == previous.recentlyWatched &&
            history.watchStates == previous.watchStates) return
        val updated = previous.copy(continueWatching = history.continueItems,
            recentlyWatched = history.recentItems, watchStates = history.watchStates)
        displayedHomeData = updated
        renderHistoryShelves(updated)
    }

    /** Refresh only history rows; the hero, latest titles, artwork and other focused rows stay put. */
    private fun renderHistoryShelves(data: HomeData) {
        val feed = homeFeed ?: return
        val focused = feed.findFocus()
        val focusedContent = focused?.tag as? String
        val historyKeys = setOf("continue_watching", "recent_channels")
        for (index in feed.childCount - 1 downTo 0) {
            if (HomeRowOrder.key(feed.getChildAt(index)) in historyKeys) feed.removeViewAt(index)
        }
        actionViews.keys.filter { it.startsWith("poster_continue_") || it.startsWith("poster_recent_") }
            .toList().forEach(actionViews::remove)
        val holder = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (data.continueWatching.isNotEmpty()) {
            addShelf(holder, "تابع المشاهدة", "أكمل من آخر نقطة", "continue", data.providerId,
                data.continueWatching, data.watchStates)
        }
        if (data.recentlyWatched.isNotEmpty()) {
            addShelf(holder, "شاهدت مؤخرًا", "ارجع بسرعة لآخر ما فتحته", "recent", data.providerId, data.recentlyWatched)
        }
        var index = minOf(1, feed.childCount)
        while (holder.childCount > 0) {
            val row = holder.getChildAt(0)
            holder.removeViewAt(0)
            feed.addView(row, index++)
        }
        HomeRowOrder.apply(feed, ProfileLibraryStore.homeRows(this))
        if (focused != null && focused.isShown) focused.requestFocus()
        else if (focusedContent != null) {
            actionViews.values.firstOrNull { it.tag == focusedContent && it.isShown }?.requestFocus()
                ?: firstAction?.requestFocus()
        }
    }

    private fun ratingValue(raw: String?): Double = raw?.replace(',', '.')?.toDoubleOrNull()?.let { if (it <= 5.0) it * 2.0 else it } ?: 0.0
    private fun hasArabic(value: String): Boolean = value.any { it in '\u0600'..'\u06FF' }

    private fun renderHero(item: StreamEntity) {
        heroKicker?.text = getString(if (item.kind == "series") R.string.home_new_series else R.string.home_new_movie)
        heroTitle?.text = ContentPresentation.of(item).title
        heroMeta?.text = buildList {
            item.year?.takeIf(String::isNotBlank)?.let(::add)
            item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
            item.genre?.substringBefore(',')?.trim()?.takeIf(String::isNotBlank)?.let(::add)
            addAll(qualityBadges(item).filter { it != "NEW" }.take(3))
            add(if (item.kind == "series") getString(R.string.home_series_type) else getString(R.string.home_movie_type))
        }.joinToString("   •   ")
        heroSubtitle?.text = item.plot?.takeIf(String::isNotBlank)?.take(210)
            ?: if (item.kind == "series") "مسلسل مضاف حديثًا إلى مكتبتك — اكتشف المواسم والحلقات." else "فيلم مضاف حديثًا إلى مكتبتك — جاهز للمشاهدة الآن."
        heroPrimary?.text = getString(if (item.kind == "series") R.string.home_view_series else R.string.home_watch_now)
        heroArtwork?.let {
            it.animate().cancel()
            it.alpha = .10f
            ArtworkLoader.loadPriority(it, listOf(item.backdrop, item.icon))
            it.animate().alpha(.88f).setDuration(330).start()
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
                    cornerRadius = dp(2).toFloat()
                    setColor(if (index == heroIndex) PURPLE_BRIGHT else 0x667B6A89)
                }
            }, LinearLayout.LayoutParams(if (index == heroIndex) dp(14) else dp(4), dp(3)).apply { marginStart = dp(5) })
        }
    }

    private fun renderSkeleton() {
        val feed = homeFeed ?: return
        val hero = feed.getChildAt(0)
        feed.removeViews(1, (feed.childCount - 1).coerceAtLeast(0))
        repeat(3) { shelfIndex ->
            feed.addView(sectionTitle(if (shelfIndex == 0) "جاري تجهيز مكتبتك" else "", if (shelfIndex == 0) "نرتب المحتوى لك…" else ""))
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = uiDirection; setPadding(0, dp(5), 0, dp(12)) }
            repeat(if (remote) 5 else 6) {
                row.addView(View(this).apply { background = skeletonSurface() }, LinearLayout.LayoutParams(dp(posterWidth), dp(posterHeight)).apply { marginStart = dp(10) })
            }
            feed.addView(row, LinearLayout.LayoutParams(-1, dp(posterHeight + 22)))
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

        if (data.ultraHd.isNotEmpty()) addShelf(feed, "4K • UHD", "للمحتوى عالي الجودة", "4k", data.providerId, data.ultraHd)

        feed.addView(sectionTitle("اختصارات سريعة", "وصل لأقسامك بضغطة واحدة").also { HomeRowOrder.mark(it, HomeRowOrder.QUICK_SHORTCUTS) })
        val quick = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            gravity = Gravity.CENTER
            clipChildren = false
            setPadding(0, 0, 0, dp(22))
        }
        addStory(quick, "live_story", "البث المباشر", "قنواتك الآن", contentIntent("live"))
        addStory(quick, "movie_story", "الأفلام", "سينما", contentIntent("movie"))
        addStory(quick, "series_story", "المسلسلات", "مواسم وحلقات", contentIntent("series"))
        addStory(quick, "favorite_story", "المفضلة", "اختياراتك", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES))
        addStory(quick, "search_story", "البحث", "ابحث فورًا", Intent(this, SearchActivity::class.java))
        if (layoutSpec.compact) {
            feed.addView(CinemaStyle.actionStrip(this, quick), LinearLayout.LayoutParams(-1, dp(100)))
        } else feed.addView(quick, LinearLayout.LayoutParams(-1, dp(100)))

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
        val rowKey = HomeRowOrder.shelfKey(prefix)
        parent.addView(sectionTitle(title, subtitle).also { HomeRowOrder.mark(it, rowKey) })
        val scroll = HorizontalScrollView(this).apply {
            HomeRowOrder.mark(this, rowKey)
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipChildren = false
            clipToPadding = false
            // Keep physical scroll coordinates stable when profile ordering reattaches the row.
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(5), dp(4), dp(12))
            clipChildren = false
            clipToPadding = false
        }
        val landscape = prefix == "continue"
        val cardWidth = if (landscape) if (layoutSpec.compact) 208 else 224 else posterWidth
        val cardHeight = if (landscape) cardWidth * 9 / 16 + 24 else posterHeight
        items.take(18).forEachIndexed { index, item ->
            row.addView(
                posterCard(providerId, item, "poster_${prefix}_${item.kind}_$index", states[item.key], landscape),
                LinearLayout.LayoutParams(dp(cardWidth), dp(cardHeight)).apply { marginStart = dp(9); marginEnd = dp(3) }
            )
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))
        scroll.doOnLayout { scroll.scrollTo(if (uiDirection == View.LAYOUT_DIRECTION_RTL) (row.width - scroll.width).coerceAtLeast(0) else 0, 0) }
        parent.addView(scroll, LinearLayout.LayoutParams(-1, dp(cardHeight + 22)))
    }

    private fun addTopTenShelf(parent: LinearLayout, providerId: String, items: List<StreamEntity>) {
        if (items.isEmpty()) return
        parent.addView(sectionTitle("TOP 10", "الأكثر تميزًا في مكتبتك الآن"))
        val scroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER; layoutDirection = View.LAYOUT_DIRECTION_LTR; clipToPadding = false }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = uiDirection; setPadding(dp(4), dp(6), dp(4), dp(14)); clipChildren = false }
        items.take(10).forEachIndexed { index, item ->
            val wrap = FrameLayout(this)
            val number = TextView(this).apply {
                text = "${index + 1}"
                textSize = if (compactTv) 36f else 42f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(0xFF606671.toInt())
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                includeFontPadding = false
            }
            wrap.addView(number, FrameLayout.LayoutParams(dp(52), -1, Gravity.START or Gravity.BOTTOM))
            val card = posterCard(providerId, item, "top10_${index}", null)
            wrap.addView(card, FrameLayout.LayoutParams(dp(posterWidth), dp(posterHeight), Gravity.END or Gravity.CENTER_VERTICAL))
            row.addView(wrap, LinearLayout.LayoutParams(dp(posterWidth + 52), dp(posterHeight + 8)).apply { marginStart = dp(8) })
        }
        scroll.addView(row, FrameLayout.LayoutParams(-2, -1))
        scroll.doOnLayout { scroll.scrollTo(if (uiDirection == View.LAYOUT_DIRECTION_RTL) (row.width - scroll.width).coerceAtLeast(0) else 0, 0) }
        parent.addView(scroll, LinearLayout.LayoutParams(-1, dp(posterHeight + 28)))
    }

    private fun sectionTitle(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = uiDirection
        gravity = Gravity.START
        setPadding(0, dp(12), dp(4), dp(6))
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); setTextColor(TEXT_PRIMARY); gravity = Gravity.START })
        contentDescription = listOf(title, subtitle).filter(String::isNotBlank).joinToString(". ")
    }

    private fun posterCard(providerId: String, item: StreamEntity, key: String, state: WatchStateEntity?, landscape: Boolean = false) = FrameLayout(this).apply {
        id = View.generateViewId()
        tag = item.key
        isFocusable = true
        isFocusableInTouchMode = remote
        isClickable = true
        background = posterSurface(false)
        clipChildren = false
        clipToOutline = true

        val poster = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(0xFF17101F.toInt()) }
        addView(poster, FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(2), dp(2), dp(2), dp(2)) })
        ArtworkLoader.loadPriority(poster, if (landscape) listOf(item.backdrop, item.icon) else listOf(item.icon, item.backdrop))

        val badges = qualityBadges(item)
        if (badges.isNotEmpty()) {
            val badgeRow = LinearLayout(this@HomeActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = uiDirection; gravity = Gravity.START }
            badges.take(if (compactTv) 2 else 3).forEach { badge -> badgeRow.addView(badgeChip(badge), LinearLayout.LayoutParams(-2, dp(18)).apply { marginStart = dp(4) }) }
            addView(badgeRow, FrameLayout.LayoutParams(-2, dp(22), Gravity.TOP or Gravity.END).apply { topMargin = dp(8); marginEnd = dp(8) })
        }

        addView(View(this@HomeActivity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xED0C0812.toInt(), 0x700C0812, Color.TRANSPARENT))
        }, FrameLayout.LayoutParams(-1, dp(94), Gravity.BOTTOM))

        val text = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            gravity = Gravity.BOTTOM or Gravity.START
            setPadding(dp(10), dp(8), dp(10), dp(10))
            addView(TextView(this@HomeActivity).apply { text = ContentPresentation.of(item).title; textSize = 12.2f; typeface = Typeface.DEFAULT_BOLD; maxLines = 2; setTextColor(Color.WHITE); gravity = Gravity.START })
            addView(TextView(this@HomeActivity).apply {
                text = buildList {
                    item.year?.takeIf(String::isNotBlank)?.let(::add)
                    item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    episodeHint(item.name)?.let(::add)
                }.joinToString("  •  ")
                textSize = 10.2f; maxLines = 1; setTextColor(0xFFD9C5EC.toInt()); gravity = Gravity.START
            })
        }
        addView(text, FrameLayout.LayoutParams(-1, dp(94), Gravity.BOTTOM))

        if (state != null && state.durationMs > 0L) {
            val progress = (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
            val track = FrameLayout(this@HomeActivity).apply { background = roundedColor(0x664E3C5F, 4) }
            val fill = View(this@HomeActivity).apply { background = roundedColor(PURPLE_BRIGHT, 4) }
            track.addView(fill, FrameLayout.LayoutParams(0, dp(3)))
            track.doOnLayout { fill.layoutParams = (fill.layoutParams as FrameLayout.LayoutParams).apply { width = (track.width * progress).toInt() } }
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
            animateFocus(view, focused, 1.015f, 0f, dp(15).toFloat())
        }
        setOnClickListener { openDetails(providerId, item) }
        registerAction(key, this)
    }

    private fun qualityBadges(item: StreamEntity): List<String> {
        val source = "${item.name} ${item.genre.orEmpty()} ${item.extension.orEmpty()}"
        val result = ContentPresentation.of(item).badges.toMutableList()
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
        textSize = 8f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setPadding(dp(7), 0, dp(7), 0)
        background = roundedColor(0xDB12161D.toInt(), 3)
    }

    private fun addFeaturedBanner(parent: LinearLayout, providerId: String, item: StreamEntity) {
        parent.addView(sectionTitle("مميز لك", "اختيار بارز من مكتبتك"))
        val card = FrameLayout(this).apply {
            id = View.generateViewId(); isFocusable = true; isFocusableInTouchMode = remote; isClickable = true; background = heroSurface(); clipChildren = true
            val art = ImageView(this@HomeActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .50f }
            addView(art, FrameLayout.LayoutParams(-1, -1)); ArtworkLoader.loadPriority(art, listOf(item.backdrop, item.icon))
            addView(View(this@HomeActivity).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF5181021.toInt(), 0xB52A1738.toInt(), 0x4017101F)) }, FrameLayout.LayoutParams(-1, -1))
            val copy = LinearLayout(this@HomeActivity).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START; layoutDirection = uiDirection; setPadding(dp(28), dp(18), dp(28), dp(18))
                addView(TextView(this@HomeActivity).apply { text = "BLOFY FEATURED"; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START })
                addView(TextView(this@HomeActivity).apply { text = ContentPresentation.of(item).title; textSize = 27f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.START; maxLines = 1 })
                addView(TextView(this@HomeActivity).apply { text = buildList { item.year?.let(::add); item.rating?.let { add("★ $it") }; item.genre?.substringBefore(',')?.let(::add) }.joinToString("   •   "); textSize = 12.5f; setTextColor(TEXT_SECONDARY); gravity = Gravity.START })
                addView(TextView(this@HomeActivity).apply { text = item.plot?.take(150) ?: "اكتشف هذا الاختيار الآن."; textSize = 13f; setTextColor(TEXT_SECONDARY); gravity = Gravity.START; maxLines = 2; setPadding(0, dp(5), 0, 0) })
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
        if (!prefs.contains("headline") && !prefs.contains("image_url")) return
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
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START; layoutDirection = uiDirection; setPadding(dp(26), dp(14), dp(26), dp(14))
                addView(TextView(this@HomeActivity).apply { text = "BLOFY SPOTLIGHT"; textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START })
                addView(TextView(this@HomeActivity).apply { text = headline; textSize = 22f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.START })
                addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 12.5f; maxLines = 2; setTextColor(TEXT_SECONDARY); gravity = Gravity.START })
            }, FrameLayout.LayoutParams(-1, -1))
        }
        parent.addView(card, LinearLayout.LayoutParams(-1, dp(126)).apply { topMargin = dp(8); bottomMargin = dp(10) })
    }

    private fun compactEmpty(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START; layoutDirection = uiDirection; setPadding(dp(20), dp(14), dp(20), dp(14)); background = surface(false)
        addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); setTextColor(TEXT_PRIMARY); gravity = Gravity.START })
        addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11.5f; setTextColor(TEXT_MUTED); gravity = Gravity.START })
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(80)).apply { bottomMargin = dp(10) } }

    private fun emptyState(title: String, subtitle: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; layoutDirection = uiDirection; setPadding(dp(30), dp(30), dp(30), dp(30)); background = surface(false)
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
        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background)
            layoutDirection = uiDirection
        }
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            setPadding(dp(layoutSpec.gutter), dp(14), dp(layoutSpec.gutter), dp(14))
        }
        root.addView(shell, FrameLayout.LayoutParams(-1, -1))
        // The rail fits all eight rows at 540dp and keeps a scroll fallback for shorter TVs.
        val rail = ScrollView(this).apply {
            tag = "blofy_home_rail"
            isVerticalScrollBarEnabled = false
            isFocusable = false
            isFocusableInTouchMode = false
            descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS
            overScrollMode = View.OVER_SCROLL_NEVER
            background = GradientDrawable().apply {
                setColor(CinemaStyle.Surface); cornerRadius = dp(18).toFloat()
                setStroke(dp(1), 0x66FFFFFF)
            }
            addView(buildSidebar(), FrameLayout.LayoutParams(-1, -2))
        }
        shell.addView(rail, LinearLayout.LayoutParams(dp(layoutSpec.railWidth), -1).apply { marginEnd = dp(12) })
        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
        }
        shell.addView(main, LinearLayout.LayoutParams(0, -1, 1f))
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val welcome = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        welcome.addView(TextView(this).apply {
            text = "BLOFY PLAYER"; textSize = 10f; letterSpacing = .12f
            setTextColor(PURPLE_BRIGHT); includeFontPadding = false
        })
        welcome.addView(TextView(this).apply {
            text = getString(R.string.home_today); textSize = 20f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(TEXT_PRIMARY); includeFontPadding = false
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(4) })
        header.addView(welcome, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(18) })
        serverLabel = TextView(this).apply {
            text = "BLOFY"; textSize = 11f; setTextColor(TEXT_MUTED)
            isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
        }
        header.addView(serverLabel, LinearLayout.LayoutParams(0, -2, 1f))
        clockLabel = TextView(this).apply {
            textSize = 10f; setTextColor(TEXT_MUTED)
            gravity = Gravity.END; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
        }
        header.addView(clockLabel, LinearLayout.LayoutParams(dp(if (layoutSpec.width < 800) 120 else 166), -2).apply { marginStart = dp(10) })
        main.addView(header, LinearLayout.LayoutParams(-1, dp(58)))
        val scroll = ScrollView(this).apply {
            tag = "blofy_home_feed_scroll"
            isVerticalScrollBarEnabled = false
            isFocusable = false
            isFocusableInTouchMode = false
            overScrollMode = View.OVER_SCROLL_NEVER
            descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS
        }
        val feed = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutDirection = uiDirection
            clipChildren = false; clipToPadding = false
            setPadding(dp(5), dp(5), dp(5), dp(24))
        }
        homeFeed = feed
        feed.addView(buildHero(), LinearLayout.LayoutParams(-1, dp(layoutSpec.heroHeight)).apply { bottomMargin = dp(8) })
        scroll.addView(feed, FrameLayout.LayoutParams(-1, -2))
        main.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        return root
    }

    private fun buildSidebar() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        layoutDirection = uiDirection
        setPadding(dp(8), dp(12), dp(8), dp(12))
        clipChildren = false
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            contentDescription = "BLOFY PLAYER"
        }, LinearLayout.LayoutParams(dp(72), dp(44)).apply { bottomMargin = dp(18) })
        addView(sideSelected(R.drawable.cinema_home, getString(R.string.home_home)))
        addView(sideAction("side_live", R.drawable.cinema_live, getString(R.string.home_live), contentIntent("live")))
        addView(sideAction("side_movies", R.drawable.cinema_movies, getString(R.string.home_movies), contentIntent("movie")))
        addView(sideAction("side_series", R.drawable.cinema_series, getString(R.string.home_series), contentIntent("series")))
        addView(sideAction("side_collections", R.drawable.cinema_collections, getString(R.string.home_collections), collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)))
        addView(sideAction("side_favorites", R.drawable.cinema_favorite, getString(R.string.home_favorites), Intent(this@HomeActivity, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)))
        addView(sideAction("side_search", R.drawable.cinema_search, getString(R.string.home_search), Intent(this@HomeActivity, SearchActivity::class.java)))
        addView(sideAction("side_settings", R.drawable.cinema_settings, getString(R.string.home_settings), Intent(this@HomeActivity, SettingsActivity::class.java)))
    }

    private fun sideBase(icon: Int, label: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        layoutDirection = uiDirection; setPadding(dp(9), 0, dp(9), 0)
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(icon); imageTintList = ColorStateList.valueOf(TEXT_MUTED)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(17), dp(17)).apply { marginEnd = dp(8) })
        addView(TextView(this@HomeActivity).apply {
            text = label; textSize = 12f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(TEXT_PRIMARY); gravity = Gravity.START or Gravity.CENTER_VERTICAL
            isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, -1, 1f))
    }.also { it.layoutParams = LinearLayout.LayoutParams(-1, dp(railRowHeight)).apply { bottomMargin = dp(7) } }

    private fun sideSelected(icon: Int, label: String) = sideBase(icon, label).apply {
        id = View.generateViewId(); tag = "side_home"
        isFocusable = true; isFocusableInTouchMode = remote; isClickable = true
        background = CinemaStyle.surface(this@HomeActivity)
        (getChildAt(0) as? ImageView)?.imageTintList = ColorStateList.valueOf(PURPLE_BRIGHT)
        (getChildAt(1) as? TextView)?.setTextColor(PURPLE_BRIGHT)
        setOnFocusChangeListener { view, focused ->
            view.background = CinemaStyle.surface(this@HomeActivity, focused)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, "side_home")
        }
        setOnClickListener {
            findViewById<View>(android.R.id.content)
                .findViewWithTag<ScrollView>("blofy_home_feed_scroll")?.scrollTo(0, 0)
            heroPrimary?.post { heroPrimary?.requestFocus() }
        }
        registerAction("side_home", this)
    }
    private fun sideAction(key: String, icon: Int, label: String, intent: Intent) = sideBase(icon, label).apply {
        id = View.generateViewId(); tag = key
        isFocusable = true; isFocusableInTouchMode = remote; isClickable = true
        background = transparentSurface(false)
        setOnFocusChangeListener { view, focused ->
            view.background = transparentSurface(focused)
            (getChildAt(0) as? ImageView)?.imageTintList = ColorStateList.valueOf(if (focused) PURPLE_BRIGHT else TEXT_MUTED)
            (getChildAt(1) as? TextView)?.setTextColor(TEXT_PRIMARY)
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
            animateFocus(view, focused, 1f, 0f, 0f)
        }
        setOnClickListener { startActivity(intent) }; registerAction(key, this)
    }

    private fun buildHero() = FrameLayout(this).apply {
        tag = "blofy_home_hero"
        clipToOutline = true; background = heroSurface()
        heroArtwork = ImageView(this@HomeActivity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .88f
        }.also { addView(it, FrameLayout.LayoutParams(-1, -1)) }
        addView(View(this@HomeActivity).apply {
            val direction = if (layoutSpec.compact) GradientDrawable.Orientation.TOP_BOTTOM else if (uiDirection == View.LAYOUT_DIRECTION_RTL) GradientDrawable.Orientation.LEFT_RIGHT else GradientDrawable.Orientation.RIGHT_LEFT
            background = GradientDrawable(direction, intArrayOf(0x08090B10, 0xA9090B10.toInt(), 0xFA090B10.toInt()))
        }, FrameLayout.LayoutParams(-1, -1))
        val content = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            layoutDirection = uiDirection
            setPadding(dp(18), dp(16), dp(18), dp(if (layoutSpec.compact) 26 else 16))
        }
        heroContent = content
        heroKicker = TextView(this@HomeActivity).apply {
            text = "BLOFY PLAYER"; textSize = 10f
            typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT)
            gravity = Gravity.START; includeFontPadding = false
        }.also { content.addView(it) }
        heroTitle = TextView(this@HomeActivity).apply {
            text = getString(R.string.home_all_content)
            textSize = if (layoutSpec.compact || compactTv) 24f else 28f
            typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
            gravity = Gravity.START; maxLines = 2; ellipsize = TextUtils.TruncateAt.END
            includeFontPadding = false; setPadding(0, dp(5), 0, 0)
        }.also { content.addView(it) }
        heroMeta = TextView(this@HomeActivity).apply {
            text = getString(R.string.home_all_content_meta); textSize = 11f
            setTextColor(0xFFDDD3E9.toInt()); gravity = Gravity.START
            isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(5), 0, 0)
        }.also { content.addView(it) }
        heroSubtitle = TextView(this@HomeActivity).apply {
            text = getString(R.string.home_all_content_subtitle); textSize = 12f
            setTextColor(TEXT_SECONDARY); gravity = Gravity.START
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(6), 0, dp(7))
        }.also { content.addView(it) }
        heroDots = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.HORIZONTAL; layoutDirection = uiDirection
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }.also { addView(it, FrameLayout.LayoutParams(-2, dp(12), Gravity.BOTTOM or Gravity.END).apply { marginEnd = dp(20); bottomMargin = dp(12) }) }
        val row = LinearLayout(this@HomeActivity).apply {
            orientation = LinearLayout.HORIZONTAL; layoutDirection = uiDirection; gravity = Gravity.START
            clipChildren = false
        }
        heroPrimary = actionHeroButton(getString(R.string.home_watch_now), "hero_watch", true) { openHeroItem() }
        row.addView(heroPrimary, LinearLayout.LayoutParams(dp(104), dp(layoutSpec.actionHeight)).apply { marginEnd = dp(10) })
        row.addView(heroButton(getString(R.string.home_explore_movies), "hero_movies", contentIntent("movie"), false), LinearLayout.LayoutParams(dp(122), dp(layoutSpec.actionHeight)))
        content.addView(CinemaStyle.actionStrip(this@HomeActivity, row))
        val available = layoutSpec.width - layoutSpec.gutter * 2 - layoutSpec.railWidth - 22
        val contentWidth = if (layoutSpec.compact) -1 else dp((available * .74f).toInt().coerceAtLeast(280).coerceAtMost(available))
        addView(content, FrameLayout.LayoutParams(contentWidth, if (layoutSpec.compact) -2 else -1,
            Gravity.START or if (layoutSpec.compact) Gravity.BOTTOM else Gravity.TOP))
    }

    private fun actionHeroButton(label: String, key: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        id = View.generateViewId(); text = label
        CinemaStyle.styleButton(this, primary) { focused ->
            if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key)
        }
        setOnClickListener { action() }; registerAction(key, this)
    }
    private fun heroButton(label: String, key: String, intent: Intent, primary: Boolean) = actionHeroButton(label, key, primary) { startActivity(intent) }

    private fun addStory(row: LinearLayout, key: String, title: String, subtitle: String, intent: Intent) {
        val card = LinearLayout(this).apply {
            id = View.generateViewId(); orientation = LinearLayout.VERTICAL; gravity = Gravity.BOTTOM or Gravity.START; layoutDirection = uiDirection; setPadding(dp(16), dp(13), dp(16), dp(13)); background = storySurface(false); isFocusable = true; isFocusableInTouchMode = remote; isClickable = true
            addView(TextView(this@HomeActivity).apply { text = title; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START })
            addView(TextView(this@HomeActivity).apply { text = subtitle; textSize = 11f; setTextColor(TEXT_MUTED); gravity = Gravity.START })
            setOnFocusChangeListener { view, focused -> view.background = storySurface(focused); childrenTextColor(this, focused); if (focused) FocusMemory.save(this@HomeActivity, SCREEN_KEY, key); animateFocus(view, focused, 1.015f, 0f, dp(10).toFloat()) }
            setOnClickListener { startActivity(intent) }
        }
        registerAction(key, card); row.addView(card, (if (layoutSpec.compact) LinearLayout.LayoutParams(dp(132), dp(76)) else LinearLayout.LayoutParams(0, -1, 1f)).apply { marginStart = dp(6); marginEnd = dp(6) })
    }

    private fun buildCompactHome(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutDirection = uiDirection
            setBackgroundColor(CinemaStyle.Background)
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; layoutDirection = uiDirection
            setPadding(dp(16), 0, dp(12), 0)
        }
        header.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo); scaleType = ImageView.ScaleType.CENTER_INSIDE
            contentDescription = "BLOFY PLAYER"
        }, LinearLayout.LayoutParams(dp(48), dp(44)))
        header.addView(TextView(this).apply {
            text = "BLOFY PLAYER"; textSize = 12f; setTextColor(TEXT_PRIMARY)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(touchNav("mobile_search", R.drawable.cinema_search, getString(R.string.home_search),
            Intent(this, SearchActivity::class.java), iconOnly = true), LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(touchNav("mobile_settings", R.drawable.cinema_settings, getString(R.string.home_settings),
            Intent(this, SettingsActivity::class.java), iconOnly = true), LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header, LinearLayout.LayoutParams(-1, dp(52)))
        val tabs = LinearLayout(this).apply {
            layoutDirection = uiDirection; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(12), 0)
        }
        listOf("live" to R.string.home_live, "movie" to R.string.home_movies, "series" to R.string.home_series).forEach { (kind, label) ->
            tabs.addView(actionHeroButton(getString(label), "tab_" + kind, false) { startActivity(contentIntent(kind)) },
                LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(4); marginEnd = dp(4) })
        }
        root.addView(tabs, LinearLayout.LayoutParams(-1, dp(52)))
        val scroll = ScrollView(this).apply {
            tag = "blofy_home_feed_scroll"; isVerticalScrollBarEnabled = false
            isFocusable = false; isFocusableInTouchMode = false; overScrollMode = View.OVER_SCROLL_NEVER
        }
        val feed = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutDirection = uiDirection
            setPadding(dp(16), 0, dp(16), dp(16)); clipChildren = false; clipToPadding = false
        }
        homeFeed = feed
        feed.addView(buildHero(), LinearLayout.LayoutParams(-1, dp(layoutSpec.heroHeight)))
        scroll.addView(feed, FrameLayout.LayoutParams(-1, -2))
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val bottom = LinearLayout(this).apply {
            tag = "blofy_home_bottom_nav"; layoutDirection = uiDirection
            setBackgroundColor(CinemaStyle.Surface); setPadding(dp(8), 0, dp(8), 0)
        }
        bottom.addView(touchNav("mobile_home", R.drawable.cinema_home, getString(R.string.home_home), null), LinearLayout.LayoutParams(0, -1, 1f))
        bottom.addView(touchNav("mobile_live", R.drawable.cinema_live, getString(R.string.home_live), contentIntent("live")), LinearLayout.LayoutParams(0, -1, 1f))
        bottom.addView(touchNav("mobile_library", R.drawable.cinema_favorite, getString(R.string.home_favorites),
            Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_FAVORITES)), LinearLayout.LayoutParams(0, -1, 1f))
        bottom.addView(touchNav("mobile_collections", R.drawable.cinema_collections, getString(R.string.home_collections),
            collectionIntent(SmartCollectionsActivity.MODE_TOP_RATED)), LinearLayout.LayoutParams(0, -1, 1f))
        root.addView(bottom, LinearLayout.LayoutParams(-1, dp(60)))
        return root
    }

    private fun touchNav(key: String, icon: Int, label: String, intent: Intent?, iconOnly: Boolean = false) = LinearLayout(this).apply {
        tag = key; orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
        isFocusable = true; isFocusableInTouchMode = false; isClickable = true
        contentDescription = label; isSelected = key == "mobile_home"
        addView(ImageView(this@HomeActivity).apply {
            setImageResource(icon); imageTintList = ColorStateList.valueOf(if (key == "mobile_home") PURPLE_BRIGHT else TEXT_MUTED)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(20), dp(20)))
        if (!iconOnly) addView(TextView(this@HomeActivity).apply {
            text = label; textSize = 10f; isSingleLine = true; ellipsize = TextUtils.TruncateAt.END
            setTextColor(if (key == "mobile_home") PURPLE_BRIGHT else TEXT_MUTED)
            setPadding(0, dp(4), 0, 0); gravity = Gravity.CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(-1, -2))
        setOnFocusChangeListener { view, focused -> view.background = transparentSurface(focused) }
        setOnClickListener { if (intent != null) startActivity(intent) else findViewById<View>(android.R.id.content).findViewWithTag<ScrollView>("blofy_home_feed_scroll")?.smoothScrollTo(0, 0) }
        registerAction(key, this)
    }

    private fun contentIntent(kind: String): Intent = if (deviceKind == DeviceClass.Kind.TV) {
        if (kind == "live") Intent(this, ContentBrowserActivity::class.java).putExtra(ContentBrowserActivity.EXTRA_KIND, kind)
        else Intent(this, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, kind)
    } else Intent(this, MobileContentActivity::class.java).putExtra(MobileContentActivity.EXTRA_KIND, kind)

    private fun collectionIntent(mode: String): Intent = Intent(this, SmartCollectionsActivity::class.java).putExtra(SmartCollectionsActivity.EXTRA_MODE, mode)
    private fun animateFocus(view: View, focused: Boolean, scale: Float, translateX: Float, elevation: Float) {
        view.animate().cancel(); view.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f).translationX(if (focused) translateX else 0f).translationZ(if (focused) elevation else dp(1).toFloat()).alpha(if (focused) 1f else .97f).setDuration(if (focused) 95 else 80).start()
    }

    private fun registerAction(key: String, view: View) { actionViews[key] = view; if (firstAction == null) firstAction = view }
    private fun restoreFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY); val target = saved?.let { actionViews[it] } ?: firstAction ?: actionViews.values.firstOrNull(); target?.post { target.requestFocus() } }
    private fun restoreDynamicFocus() { if (deviceKind != DeviceClass.Kind.TV) return; val saved = FocusMemory.restore(this, SCREEN_KEY) ?: return; actionViews[saved]?.post { actionViews[saved]?.requestFocus() } }
    private fun childrenTextColor(layout: LinearLayout, focused: Boolean) { for (i in 0 until layout.childCount) (layout.getChildAt(i) as? TextView)?.setTextColor(if (focused) Color.WHITE else if (i == layout.childCount - 1) PURPLE_BRIGHT else TEXT_PRIMARY) }

    private fun roundedColor(color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color); stroke?.let { setStroke(dp(1), it) } }
    private fun surface(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 14)
    private fun selectedSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF8D4AE2.toInt(), 0xFF502779.toInt())).apply { cornerRadius = dp(15).toFloat(); setStroke(dp(1), 0xFFC9A1F4.toInt()) }
    private fun transparentSurface(focused: Boolean) = roundedColor(if (focused) CinemaStyle.Surface else Color.TRANSPARENT, 6, if (focused) Color.WHITE else null)
    private fun heroSurface() = CinemaStyle.surface(this, radiusDp = 16)
    private fun promoSurface() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xFF4B276A.toInt(), 0xFF20142E.toInt(), 0xFF121019.toInt())).apply { cornerRadius = dp(20).toFloat(); setStroke(dp(1), 0xFF7F56A0.toInt()) }
    private fun featuredSurface(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 18)
    private fun posterSurface(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 8)
    private fun storySurface(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 14)
    private fun compactTile(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 16)
    private fun skeletonSurface() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF2B2137.toInt(), 0xFF18131F.toInt())).apply { cornerRadius = dp(16).toFloat(); setStroke(dp(1), 0xFF43344F.toInt()) }
    private fun title(value: String, size: Float) = TextView(this).apply { text = value; textSize = size; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.START }
    private fun subtitle(value: String, bottom: Int) = TextView(this).apply { text = value; textSize = 15f; setTextColor(PURPLE_BRIGHT); gravity = Gravity.START; setPadding(0, dp(4), 0, bottom) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val SCREEN_KEY = "home"
        private const val HERO_ROTATION_MS = 8_000L
        private val PURPLE_BRIGHT = Color.rgb(184, 160, 237)
        private val TEXT_PRIMARY = Color.rgb(249, 247, 252)
        private val TEXT_SECONDARY = Color.rgb(224, 216, 232)
        private val TEXT_MUTED = Color.rgb(154, 162, 177)
    }
}
