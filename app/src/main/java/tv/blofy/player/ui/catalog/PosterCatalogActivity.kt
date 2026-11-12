package tv.blofy.player.ui.catalog

import tv.blofy.player.ui.common.CinemaStyle

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CatalogTotals
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.common.TwoPaneFocusGuard
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.data.metadata.ProviderDetailsRepository
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.RuntimeSettings

class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private lateinit var sortControl: TextView
    private var sortMode = CatalogSortPolicy.Mode.SOURCE
    private lateinit var searchBar: TextView
    private var genreRefreshJob: Job? = null
    private var genreWarmJob: Job? = null
    // A bounded session-local backoff prevents repeated detail probes for titles
    // that a provider has not classified yet. No credentials enter these keys.
    private val genreWarmAttempts = LinkedHashMap<String, Long>()
    // A short rolling quota avoids overloading Xtream while allowing later
    // categories to continue filling in. The old 24-per-screen-LIFETIME cap
    // left every subsequently viewed poster stuck at generic 'فيلم'.
    private var genreQuotaCount = 0
    private var genreQuotaWindowStartedMs = 0L
    private var lastGenreBatchAtMs = 0L
    private val genreWarmRequest = Runnable { warmVisibleGenres() }
    private var pageJob: Job? = null
    private var countJob: Job? = null
    private var exactCount: Int? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private var displayedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var initialFocusRequested = false
    private val loadedItems = ArrayList<StreamEntity>(128)
    private var hasMore = true
    private var lastRowId = 0L
    private var loadingPage = false
    private var generation = 0
    private var gridColumns = 6
    private val focusedPosterKeys = mutableMapOf<String, String>()
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sortMode = runCatching {
            CatalogSortPolicy.Mode.valueOf(
                getSharedPreferences("stream_catalog_sort_v1", MODE_PRIVATE)
                    .getString(kind, CatalogSortPolicy.Mode.SOURCE.name).orEmpty()
            )
        }.getOrDefault(CatalogSortPolicy.Mode.SOURCE)
        val deviceKind = DeviceClass.detect(this)
        val widthDp = resources.configuration.screenWidthDp.takeIf { it > 0 } ?: resources.configuration.smallestScreenWidthDp
        val compactCatalog = RuntimeSettings.catalogDensity(this) == RuntimeSettings.CatalogDensity.COMPACT
        gridColumns = when (deviceKind) {
            DeviceClass.Kind.TV -> if (compactCatalog) {
                if (widthDp >= 1600) 7 else if (widthDp >= 1000) 6 else 5
            } else 5
            DeviceClass.Kind.TABLET -> if (compactCatalog) {
                if (widthDp >= 900) 6 else 5
            } else if (widthDp >= 900) 5 else 4
            DeviceClass.Kind.PHONE -> if (compactCatalog) {
                if (widthDp >= 600) 4 else 3
            } else if (widthDp >= 600) 3 else 2
        }
        val outerPadding = when (deviceKind) {
            DeviceClass.Kind.TV -> 22
            DeviceClass.Kind.TABLET -> 16
            DeviceClass.Kind.PHONE -> 8
        }
        val railWidth = when (deviceKind) {
            DeviceClass.Kind.TV -> 190
            DeviceClass.Kind.TABLET -> 180
            DeviceClass.Kind.PHONE -> 112
        }
        val railGap = when (deviceKind) {
            DeviceClass.Kind.TV -> 16
            DeviceClass.Kind.TABLET -> 12
            DeviceClass.Kind.PHONE -> 6
        }
        // Size columns from the space left after the category rail, not the whole screen.
        val contentWidthDp = (widthDp - outerPadding * 2 - railWidth - railGap - 10).coerceAtLeast(1)
        val minimumCardWidthDp = when {
            compactCatalog && deviceKind == DeviceClass.Kind.PHONE -> 92
            compactCatalog -> 108
            deviceKind == DeviceClass.Kind.PHONE -> 108
            else -> 132
        }
        gridColumns = (contentWidthDp / minimumCardWidthDp).coerceIn(1, gridColumns)

        val root = LinearLayout(this).apply {
            // Own focus while the local categories are loading; search must not flash selected.
            isFocusable = true
            isFocusableInTouchMode = deviceKind == DeviceClass.Kind.TV
            descendantFocusability = android.view.ViewGroup.FOCUS_BEFORE_DESCENDANTS
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(outerPadding), dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 14), dp(outerPadding), dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 18))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        searchBar = TextView(this).apply {
            text = getString(if (kind == KIND_SERIES) R.string.catalog_search_series else R.string.catalog_search_movies)
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            layoutDirection = resources.configuration.layoutDirection
            textSize = when (deviceKind) {
                DeviceClass.Kind.TV -> 14f
                DeviceClass.Kind.TABLET -> 16f
                DeviceClass.Kind.PHONE -> 14f
            }
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextSecondary)
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 14 else 20), 0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 14 else 20), 0)
            background = CinemaStyle.surface(this@PosterCatalogActivity)
            isFocusable = true
            isFocusableInTouchMode = deviceKind == DeviceClass.Kind.TV
            isClickable = true
            elevation = 0f
            setOnClickListener {
                startActivity(Intent(this@PosterCatalogActivity, SearchActivity::class.java)
                    .putExtra(SearchActivity.EXTRA_KIND, kind))
            }
            setOnKeyListener { _, keyCode, event ->
                if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    requestSelectedCategoryFocus()
                } else false
            }
            setOnFocusChangeListener { view, focused ->
                background = CinemaStyle.surface(this@PosterCatalogActivity, focused, filledFocus = true)
                setTextColor(if (focused) CinemaStyle.Background else CinemaStyle.White)
                view.animate().cancel()
                val scale = if (focused) TvUiTuning.focusScale(this@PosterCatalogActivity, 1.012f) else 1f
                view.animate()
                    .scaleX(scale)
                    .scaleY(scale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(this@PosterCatalogActivity, 6f) else 0f)
                    .setDuration(TvUiTuning.focusDuration(this@PosterCatalogActivity, focused))
                    .start()
            }
        }
        root.addView(searchBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(
            when (deviceKind) {
                DeviceClass.Kind.PHONE -> 46
                DeviceClass.Kind.TABLET -> 42
                DeviceClass.Kind.TV -> 42
            }
        )).apply {
            bottomMargin = dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 10)
        })

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 5 else 9), dp(8), dp(if (deviceKind == DeviceClass.Kind.PHONE) 5 else 9), dp(8))
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            elevation = 0f
        }
        rail.addView(TextView(this).apply {
            text = getString(R.string.categories)
            BlofyTvDesign.applyHeading(this)
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 13f else 14f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (deviceKind == DeviceClass.Kind.PHONE) 38 else 44)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity)
            // Poster cards have enough internal padding for focus treatment; clip
            // RecyclerView children so recycled rows never paint above the grid bounds.
            clipChildren = true
            clipToPadding = true
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(if (deviceKind == DeviceClass.Kind.TV) 10 else 6)
            preserveFocusAfterLayout = true
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(rail, LinearLayout.LayoutParams(dp(railWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(railGap) })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Keep recycled poster rows inside the catalog pane. With clipping disabled,
            // a whole off-screen row can draw over the title/search area while scrolling.
            clipChildren = true
            clipToPadding = true
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = resources.configuration.layoutDirection
        }
        header.addView(TextView(this).apply {
            text = getString(if (kind == KIND_SERIES) R.string.series else R.string.movies)
            BlofyTvDesign.applyTitle(this)
            textSize = when (deviceKind) {
                DeviceClass.Kind.TV -> 24f
                DeviceClass.Kind.TABLET -> 24f
                DeviceClass.Kind.PHONE -> 20f
            }
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 46 else 38), 1f))
        countView = TextView(this).apply {
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 10.5f else 12f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.Lavender)
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            textDirection = View.TEXT_DIRECTION_LTR
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0)
            background = BlofyTvDesign.badge(dp(BlofyTvDesign.BadgeRadius).toFloat())
        }
        sortControl = TextView(this).apply {
            text = sortModeLabel()
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 10f else 12f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER
            setPadding(dp(8), 0, dp(8), 0)
            background = CinemaStyle.surface(this@PosterCatalogActivity)
            isFocusable = true
            isClickable = true
            contentDescription = text
            setOnClickListener {
                sortMode = sortMode.next()
                text = sortModeLabel()
                contentDescription = text
                getSharedPreferences("stream_catalog_sort_v1", MODE_PRIVATE).edit()
                    .putString(kind, sortMode.name).apply()
                loadStreams(selectedCategoryId, force = true)
            }
            setOnFocusChangeListener { _, focused ->
                background = CinemaStyle.surface(this@PosterCatalogActivity, focused)
                setTextColor(if (focused) CinemaStyle.White else BlofyTvDesign.TextSecondary)
            }
        }
        header.addView(sortControl, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(30)).apply {
            marginEnd = dp(8)
        })
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(28)))
        content.addView(header)

        val manager = GridLayoutManager(this, gridColumns)
        posterGrid = RecyclerView(this).apply {
            layoutManager = manager
            setPadding(
                dp(4),
                dp(if (deviceKind == DeviceClass.Kind.TV) 8 else 4),
                dp(if (deviceKind == DeviceClass.Kind.PHONE) 2 else 6),
                dp(if (deviceKind == DeviceClass.Kind.PHONE) 10 else 18)
            )
            // Focused posters may scale inside the grid padding, but must never paint
            // over the catalog header/search area.
            clipChildren = true
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 32)
            setItemViewCacheSize(14)
            descendantFocusability = 0x40000
            preserveFocusAfterLayout = true
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrollStateChanged(recyclerView: RecyclerView, newState: Int) {
                    if (newState == RecyclerView.SCROLL_STATE_IDLE) requestVisibleGenreWarmup()
                }
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    if (dy <= 0 || loadingPage || !hasMore) return
                    if (manager.findLastVisibleItemPosition() >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
                }
            })
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (deviceKind == DeviceClass.Kind.TV) root.requestFocus()

        posterAdapter = PosterStreamAdapter(::openItem) { item, index ->
            focusedPosterKeys[memoryKey(displayedCategoryId)] = item.key
            if (index >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
        }
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(
            label = { displayCategoryName(it.name) },
            onClick = { loadStreams(categoryRemoteId(it)) },
            onFocus = null,
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        TwoPaneFocusGuard.registerTopTarget(root, searchBar)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            providerId = dao.activeProviderId() ?: run { finish(); return@launch }
            // Always display the All category on the very first frame.
            // Big Xtream imports can still be populating individual genres.
            categoryRows = listOf(allCategory())
            categoryAdapter.submit(categoryRows)
            if (loadedItems.isEmpty() && pageJob == null) loadStreams(null)
            dao.categories(providerId, kind).collect { categories ->
                categoryRows = listOf(allCategory()) + categories
                categoryAdapter.submit(categoryRows)
                posterAdapter.updateCategoryNames(categoryRows)
                requestVisibleGenreWarmup()
                // Some Android TV firmwares defer the category RecyclerView's
                // first measure until returning from MovieDetailsActivity.
                categoryList.post {
                    if (!isFinishing && !isDestroyed) {
                        categoryList.requestLayout()
                        if (loadedItems.isEmpty() && DeviceClass.isTv(this@PosterCatalogActivity))
                            requestSelectedCategoryFocus()
                    }
                }
                requestInitialContentFocus()
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::categoryList.isInitialized && ::posterGrid.isInitialized &&
            TwoPaneFocusGuard.handle(event, categoryList, posterGrid,
                ::requestSelectedCategoryFocus, ::requestPosterFocus)) return true
        return super.dispatchKeyEvent(event)
    }

    private fun loadStreams(id: String?, force: Boolean = false) {
        if (providerId.isBlank()) return
        if (!force && selectedCategoryId == id) {
            if (displayedCategoryId == id && loadedItems.isNotEmpty()) return
            if (loadingPage) return
        }

        selectedCategoryId = id
        genreRefreshJob?.cancel()
        genreWarmJob?.cancel()
        posterGrid.removeCallbacks(genreWarmRequest)
        if (force) {
            loadedItems.clear()
            displayedCategoryId = null
            posterAdapter.replace(emptyList())
        }
        generation++
        posterGrid.removeCallbacks(genreWarmRequest)
        genreWarmJob?.cancel()
        genreWarmJob = null
        refreshExactCount()
        pageJob?.cancel()
        hasMore = true
        lastRowId = 0L
        loadingPage = false

        val cached = CatalogPageMemory.get(memoryKey(id))
        if (cached != null && cached.items.isNotEmpty()) {
            // In-memory catalog pages do not include the separately persisted
            // genre metadata. Read that cache BEFORE rendering, just like a
            // fresh DB page, or labels vanish when the category changes.
            loadingPage = true
            val expectedGeneration = generation
            val snapshot = cached.items.toList()
            posterAdapter.replace(emptyList())
            countView.text = "…"
            pageJob = lifecycleScope.launch {
                val genreSnapshot = if (kind == KIND_MOVIE || kind == KIND_SERIES) withContext(Dispatchers.IO) {
                    ProviderMetadataCache.readGenresForPage(applicationContext, snapshot.map { it.key })
                } else emptyMap()
                if (generation != expectedGeneration || selectedCategoryId != id) return@launch
                loadedItems.clear()
                loadedItems.addAll(snapshot)
                displayedCategoryId = id
                lastRowId = cached.lastRowId
                hasMore = cached.total == Int.MAX_VALUE
                posterAdapter.rememberMovieGenres(genreSnapshot, reset = true)
                posterAdapter.replace(snapshot)
                cached.focusedKey?.let { focusedPosterKeys.putIfAbsent(memoryKey(id), it) }
                loadingPage = false
                updateCount()
                requestInitialContentFocus()
                requestVisibleGenreWarmup()
            }.also { job ->
                job.invokeOnCompletion {
                    if (expectedGeneration == generation) runOnUiThread { loadingPage = false }
                }
            }
            return
        }

        countView.text = "…"
        loadNextPage(true)
    }

    private fun loadNextPage(reset: Boolean = false) {
        if (providerId.isBlank() || loadingPage || (!reset && !hasMore)) return
        val requestGeneration = generation
        val requestCategoryId = selectedCategoryId
        val cursor = if (reset) 0L else lastRowId
        val offset = if (reset) 0 else loadedItems.size
        val requestedSort = sortMode
        loadingPage = true
        pageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val result = withContext(Dispatchers.IO) {
                val page = when {
                    requestedSort != CatalogSortPolicy.Mode.SOURCE ->
                        dao.catalogSortedPage(CatalogSortPolicy.query(
                            providerId, kind, requestCategoryId, requestedSort, offset, PAGE_SIZE))
                    requestCategoryId == null ->
                        dao.catalogPageAfterAll(providerId, kind, cursor, PAGE_SIZE)
                    else ->
                        dao.catalogPageAfterInCategory(providerId, kind, requestCategoryId, cursor, PAGE_SIZE)
                }
                val cachedGenres = if (kind == KIND_MOVIE || kind == KIND_SERIES) {
                    ProviderMetadataCache.readGenresForPage(
                        applicationContext, page.map { it.key }
                    )
                } else emptyMap()
                Triple(page, page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor, cachedGenres)
            }
            if (requestGeneration != generation || requestCategoryId != selectedCategoryId) return@launch
            lastRowId = result.second
            hasMore = result.first.size >= PAGE_SIZE
            if (reset) {
                loadedItems.clear()
                loadedItems.addAll(result.first)
                displayedCategoryId = requestCategoryId
                posterAdapter.rememberMovieGenres(result.third, reset = true)
                posterAdapter.replace(result.first)
            } else {
                loadedItems.addAll(result.first)
                posterAdapter.rememberMovieGenres(result.third, reset = false)
                posterAdapter.append(result.first)
            }
            updateCount()
            ArtworkLoader.prefetch(this@PosterCatalogActivity, result.first.take(6).map { it.icon?.takeIf(String::isNotBlank) ?: it.backdrop })
            loadingPage = false
            saveMemorySnapshot()
            requestInitialContentFocus()
            requestVisibleGenreWarmup()
        }.also { job ->
            job.invokeOnCompletion { if (requestGeneration == generation) runOnUiThread { loadingPage = false } }
        }
    }


    /**
     * Xtream's VOD and series list frequently omit genre even when detail API has
     * the real Action/Drama/etc. The detail screen previously populated this
     * cache only after opening a movie. Enrich *visible posters* instead, using
     * at most two requests in flight and twelve attempts per settled viewport.
     * We never scan/fetch the whole catalog, touch playback URLs, or block a
     * poster's first display. Cached genres appear immediately next time.
     */
    private fun requestVisibleGenreWarmup() {
        if (kind != KIND_MOVIE && kind != KIND_SERIES) return
        if (!::posterGrid.isInitialized || providerId.isBlank()) return
        posterGrid.removeCallbacks(genreWarmRequest)
        // Avoid competing with fast TV scrolling and the first poster paint.
        posterGrid.postDelayed(genreWarmRequest, 360L)
    }

    private fun warmVisibleGenres() {
        if ((kind != KIND_MOVIE && kind != KIND_SERIES) || loadedItems.isEmpty() || genreWarmJob?.isActive == true ||
            posterGrid.scrollState != RecyclerView.SCROLL_STATE_IDLE ||
            !::posterGrid.isInitialized || isFinishing || isDestroyed) return
        val manager = posterGrid.layoutManager as? GridLayoutManager ?: return
        val first = manager.findFirstVisibleItemPosition().takeIf { it >= 0 } ?: return
        val last = manager.findLastVisibleItemPosition().takeIf { it >= first } ?: return
        val visible = loadedItems.subList(first.coerceAtMost(loadedItems.size),
            (last + gridColumns + 1).coerceAtMost(loadedItems.size)).toList()
        if (visible.isEmpty()) return
        val currentGeneration = generation
        val owner = providerId
        val category = selectedCategoryId
        val names = categoryRows.associate { it.remoteId to it.name }
        val now = SystemClock.elapsedRealtime()
        val recent = genreWarmAttempts.filterValues { time ->
            now >= time && now - time < GENRE_ATTEMPT_BACKOFF_MS
        }.keys.toSet()

        genreWarmJob = lifecycleScope.launch {
            var fetchedBatch = false
            try {
                // Batch-read locally first. A cached detail should never
                // trigger another network round-trip just to paint its genre.
                val snapshot = withContext(Dispatchers.IO) {
                    ProviderMetadataCache.readGenresForPage(applicationContext, visible.map { it.key })
                }
                if (generation != currentGeneration || providerId != owner ||
                    selectedCategoryId != category) return@launch
                snapshot.forEach { (key, genres) -> posterAdapter.rememberMovieGenre(key, genres) }
                val now = SystemClock.elapsedRealtime()
                if (genreQuotaWindowStartedMs == 0L || now - genreQuotaWindowStartedMs >= GENRE_QUOTA_WINDOW_MS) {
                    genreQuotaWindowStartedMs = now
                    genreQuotaCount = 0
                }
                val remaining = (MAX_GENRE_REQUESTS_PER_WINDOW - genreQuotaCount).coerceAtLeast(0)
                if (remaining == 0) return@launch
                if (lastGenreBatchAtMs != 0L && now - lastGenreBatchAtMs < GENRE_BATCH_COOLDOWN_MS) {
                    posterGrid.removeCallbacks(genreWarmRequest)
                    posterGrid.postDelayed(genreWarmRequest, GENRE_BATCH_COOLDOWN_MS - (now - lastGenreBatchAtMs))
                    return@launch
                }
                val candidates = MovieGenrePrefetchPolicy.candidates(
                    visible, names, snapshot, recent, limit = minOf(3, remaining)
                )
                if (candidates.isEmpty()) return@launch
                val provider = withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao().provider(owner)
                } ?: return@launch
                if (!provider.providerType.equals("xtream", true)) return@launch
                fetchedBatch = true
                genreQuotaCount += candidates.size
                lastGenreBatchAtMs = SystemClock.elapsedRealtime()
                val slots = Semaphore(1)
                coroutineScope {
                    candidates.map { movie ->
                        launch(Dispatchers.IO) {
                            val result = slots.withPermit {
                                ProviderDetailsRepository.refresh(applicationContext, provider, movie)
                            }
                            withContext(Dispatchers.Main) {
                                genreWarmAttempts[movie.key] = SystemClock.elapsedRealtime()
                                while (genreWarmAttempts.size > 256) {
                                    genreWarmAttempts.remove(genreWarmAttempts.keys.first())
                                }
                                if (generation == currentGeneration && providerId == owner &&
                                    selectedCategoryId == category) {
                                    result.metadata?.genres?.filter(String::isNotBlank)
                                        ?.takeIf { it.isNotEmpty() }
                                        ?.let { posterAdapter.rememberMovieGenre(movie.key, it) }
                                }
                            }
                        }
                    }.joinAll()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Missing or rate-limited provider metadata must never prevent
                // browsing, cause an activation failure, or reset the catalog.
            } finally {
                if (fetchedBatch && generation == currentGeneration && providerId == owner &&
                    selectedCategoryId == category && !isFinishing && !isDestroyed &&
                    lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    // Revisit the current viewport after the bounded cooldown
                    // so genres fill in without needing the user to scroll.
                    // The 5-minute rolling quota and recently-attempted filter
                    // prevent request storms and repeated missing-title fetches.
                    if (posterGrid.scrollState == RecyclerView.SCROLL_STATE_IDLE &&
                        genreQuotaCount < MAX_GENRE_REQUESTS_PER_WINDOW) {
                        posterGrid.removeCallbacks(genreWarmRequest)
                        posterGrid.postDelayed(genreWarmRequest, GENRE_BATCH_COOLDOWN_MS)
                    }
                }
            }
        }
    }

    private fun refreshExactCount() {
        countJob?.cancel()
        exactCount = null
        countView.text = getString(R.string.catalog_count_loading)
        if (providerId.isBlank()) return
        val owner = providerId
        val categoryId = selectedCategoryId
        val requestGeneration = generation
        countJob = lifecycleScope.launch {
            try {
                val total = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    if (categoryId == null) dao.catalogCountAll(owner, kind)
                    else dao.catalogCountInCategory(owner, kind, categoryId)
                }
                if (providerId == owner && selectedCategoryId == categoryId && generation == requestGeneration) {
                    exactCount = total
                    updateCount()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // If a database is briefly unavailable, keep the clearly marked
                // paginated lower bound rather than invent a total.
                if (generation == requestGeneration) updateCount()
            }
        }
    }

    private fun updateCount() {
        val total = exactCount ?: loadedItems.size
        val suffix = if (exactCount == null && hasMore) "+" else ""
        countView.text = CatalogTotals.formatted(total) + suffix
        countView.contentDescription = getString(
            if (kind == KIND_SERIES) R.string.series_count else R.string.movie_count,
            total,
            suffix
        )
    }

    private fun saveMemorySnapshot() {
        if (providerId.isBlank() || loadedItems.isEmpty()) return
        if (displayedCategoryId != selectedCategoryId) return
        CatalogPageMemory.put(memoryKey(displayedCategoryId), loadedItems, if (hasMore) Int.MAX_VALUE else loadedItems.size, lastRowId, focusedPosterKeys[memoryKey(displayedCategoryId)])
    }

    private fun memoryKey(categoryId: String? = selectedCategoryId) =
        "$providerId:$kind:${categoryId ?: ALL_CATEGORY_ID}:${sortMode.name}"

    private fun requestPosterFocus(): Boolean {
        if (displayedCategoryId != selectedCategoryId || (loadingPage && lastRowId == 0L)) return false
        val remembered = focusedPosterKeys[memoryKey(displayedCategoryId)]
        val index = loadedItems.indexOfFirst { it.key == remembered }.coerceAtLeast(0)
        return TwoPaneFocusGuard.focusItem(posterGrid, index)
    }

    private fun requestInitialContentFocus() {
        if (initialFocusRequested || !DeviceClass.isTv(this) || loadedItems.isEmpty()) return
        initialFocusRequested = true
        posterGrid.post {
            if (!requestPosterFocus()) requestSelectedCategoryFocus()
        }
    }

    private fun requestSelectedCategoryFocus(): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val position = categoryRows.indexOfFirst { categoryRemoteId(it) == selectedCategoryId }.takeIf { it >= 0 } ?: 0
        return TwoPaneFocusGuard.focusItem(categoryList, position)
    }

    private fun openItem(stream: StreamEntity) {
        if (displayedCategoryId != selectedCategoryId) return
        startActivity(Intent(this, if (kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", stream.key)
        })
    }

    private fun sortModeLabel(): String = getString(when (sortMode) {
        CatalogSortPolicy.Mode.SOURCE -> R.string.stream_catalog_sort_source
        CatalogSortPolicy.Mode.NEWEST -> R.string.stream_catalog_sort_newest
        CatalogSortPolicy.Mode.RATING -> R.string.stream_catalog_sort_rating
        CatalogSortPolicy.Mode.YEAR -> R.string.stream_catalog_sort_year
    })

    private fun displayCategoryName(raw: String): String {
        val cleaned = raw
            .replace(Regex("^[\\s#*_~=-]{2,}|[\\s#*_~=-]{2,}$"), " ")
            .replace(Regex("(?i)\\b(?:3840p|2160p|1440p|1080p|720p|576p|480p)\\b"), " ")
            .replace(Regex("\\s{2,}"), " ")
            .trim(' ', '-', '•', '|')
        return cleaned.ifBlank { raw.trim() }
    }

    private fun allCategory() = CategoryEntity(
        "$providerId:$kind:$ALL_CATEGORY_ID",
        providerId,
        ALL_CATEGORY_ID,
        kind,
        getString(if (kind == KIND_SERIES) R.string.all_series else R.string.all_movies),
        -1
    )

    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onResume() {
        super.onResume()
        if (::categoryList.isInitialized && categoryRows.isNotEmpty()) {
            categoryList.post { if (!isFinishing && !isDestroyed) categoryList.requestLayout() }
        }
        if (providerId.isNotBlank()) refreshExactCount()
        if ((kind != KIND_MOVIE && kind != KIND_SERIES) || loadedItems.isEmpty() || !::posterAdapter.isInitialized) return
        requestVisibleGenreWarmup()
        genreRefreshJob?.cancel()
        val expectedGeneration = generation
        val owner = providerId
        val manager = posterGrid.layoutManager as? GridLayoutManager
        val first = manager?.findFirstVisibleItemPosition()?.coerceAtLeast(0) ?: 0
        val last = manager?.findLastVisibleItemPosition()?.coerceAtLeast(first) ?: minOf(first + 12, loadedItems.lastIndex)
        val keys = loadedItems.drop(first).take((last - first + gridColumns + 1).coerceAtMost(32)).map { it.key }
        genreRefreshJob = lifecycleScope.launch {
            val snapshot = withContext(Dispatchers.IO) {
                ProviderMetadataCache.readGenresForPage(applicationContext, keys)
            }
            if (generation != expectedGeneration || providerId != owner) return@launch
            posterAdapter.rememberMovieGenres(snapshot, reset = false, notifyExisting = true)
        }
    }
    override fun onPause() {
        posterGrid.removeCallbacks(genreWarmRequest)
        genreWarmJob?.cancel()
        saveMemorySnapshot()
        super.onPause()
    }
    override fun onDestroy() {
        posterGrid.removeCallbacks(genreWarmRequest)
        genreWarmJob?.cancel()
        pageJob?.cancel(); countJob?.cancel(); genreRefreshJob?.cancel()
        generation++
        super.onDestroy()
    }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val PAGE_SIZE = 64
        private const val PREFETCH_THRESHOLD = 20
        private const val GENRE_ATTEMPT_BACKOFF_MS = 10 * 60_000L
        private const val GENRE_BATCH_COOLDOWN_MS = 2_500L
        private const val MAX_GENRE_REQUESTS_PER_WINDOW = 36
        private const val GENRE_QUOTA_WINDOW_MS = 5 * 60_000L
        private const val ALL_CATEGORY_ID = "__all__"
    }
}
