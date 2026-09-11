package tv.blofy.player.ui.catalog

import tv.blofy.player.ui.common.CinemaStyle

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.common.TwoPaneFocusGuard
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.search.SearchActivity

class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private lateinit var searchBar: TextView
    private var pageJob: Job? = null
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
        val deviceKind = DeviceClass.detect(this)
        val widthDp = resources.configuration.screenWidthDp.takeIf { it > 0 } ?: resources.configuration.smallestScreenWidthDp
        gridColumns = when (deviceKind) {
            DeviceClass.Kind.TV -> if (widthDp >= 1600) 7 else if (widthDp >= 1000) 6 else 5
            DeviceClass.Kind.TABLET -> if (widthDp >= 900) 5 else 4
            DeviceClass.Kind.PHONE -> if (widthDp >= 600) 3 else 2
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
        val minimumCardWidthDp = if (deviceKind == DeviceClass.Kind.PHONE) 108 else 132
        gridColumns = if (deviceKind == DeviceClass.Kind.TV) 5
            else (contentWidthDp / minimumCardWidthDp).coerceIn(1, gridColumns)

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
            typeface = BlofyTvDesign.MediumTypeface
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
            setOnFocusChangeListener { _, focused ->
                background = CinemaStyle.surface(this@PosterCatalogActivity, focused, filledFocus = true)
                setTextColor(if (focused) CinemaStyle.Background else CinemaStyle.White)
            }
        }
        root.addView(searchBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (deviceKind == DeviceClass.Kind.PHONE) 46 else 40)).apply {
            bottomMargin = dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12)
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
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(18)
            preserveFocusAfterLayout = true
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(rail, LinearLayout.LayoutParams(dp(railWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(railGap) })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
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
        }, LinearLayout.LayoutParams(0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 46 else 40), 1f))
        countView = TextView(this).apply {
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 10.5f else 12f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(CinemaStyle.Muted)
            gravity = Gravity.CENTER
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0)
            background = CinemaStyle.surface(this@PosterCatalogActivity)
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(28)))
        content.addView(header)

        val manager = GridLayoutManager(this, gridColumns)
        posterGrid = RecyclerView(this).apply {
            layoutManager = manager
            setPadding(dp(4), dp(4), dp(if (deviceKind == DeviceClass.Kind.PHONE) 2 else 6), dp(if (deviceKind == DeviceClass.Kind.PHONE) 10 else 18))
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 32)
            setItemViewCacheSize(14)
            descendantFocusability = 0x40000
            preserveFocusAfterLayout = true
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
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
            label = { it.name },
            onClick = { loadStreams(categoryRemoteId(it)) },
            onFocus = null,
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        TwoPaneFocusGuard.registerTopTarget(root, searchBar)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            providerId = dao.activeProviderId() ?: run { finish(); return@launch }
            dao.categories(providerId, kind).collect { categories ->
                categoryRows = listOf(allCategory()) + categories
                categoryAdapter.submit(categoryRows)
                if (loadedItems.isEmpty() && pageJob == null) loadStreams(null)
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

    private fun loadStreams(id: String?) {
        if (providerId.isBlank()) return
        if (selectedCategoryId == id) {
            if (displayedCategoryId == id && loadedItems.isNotEmpty()) return
            if (loadingPage) return
        }

        selectedCategoryId = id
        generation++
        pageJob?.cancel()
        hasMore = true
        lastRowId = 0L
        loadingPage = false

        val cached = CatalogPageMemory.get(memoryKey(id))
        if (cached != null && cached.items.isNotEmpty()) {
            loadedItems.clear()
            loadedItems.addAll(cached.items)
            displayedCategoryId = id
            lastRowId = cached.lastRowId
            hasMore = cached.items.size >= PAGE_SIZE
            posterAdapter.replace(cached.items)
            cached.focusedKey?.let { focusedPosterKeys.putIfAbsent(memoryKey(id), it) }
            updateCount()
            requestInitialContentFocus()
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
        loadingPage = true
        pageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val result = withContext(Dispatchers.IO) {
                val page = if (requestCategoryId == null) {
                    dao.catalogPageAfterAll(providerId, kind, cursor, PAGE_SIZE)
                } else {
                    dao.catalogPageAfterInCategory(providerId, kind, requestCategoryId, cursor, PAGE_SIZE)
                }
                page to (page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor)
            }
            if (requestGeneration != generation || requestCategoryId != selectedCategoryId) return@launch
            lastRowId = result.second
            hasMore = result.first.size >= PAGE_SIZE
            if (reset) {
                loadedItems.clear()
                loadedItems.addAll(result.first)
                displayedCategoryId = requestCategoryId
                posterAdapter.replace(result.first)
            } else {
                loadedItems.addAll(result.first)
                posterAdapter.append(result.first)
            }
            updateCount()
            ArtworkLoader.prefetch(this@PosterCatalogActivity, result.first.take(6).map { it.icon ?: it.backdrop })
            loadingPage = false
            saveMemorySnapshot()
            requestInitialContentFocus()
        }.also { job ->
            job.invokeOnCompletion { if (requestGeneration == generation) runOnUiThread { loadingPage = false } }
        }
    }

    private fun updateCount() {
        val suffix = if (hasMore) "+" else ""
        countView.text = getString(
            if (kind == KIND_SERIES) R.string.series_count else R.string.movie_count,
            loadedItems.size,
            suffix
        )
    }

    private fun saveMemorySnapshot() {
        if (providerId.isBlank() || loadedItems.isEmpty()) return
        if (displayedCategoryId != selectedCategoryId) return
        CatalogPageMemory.put(memoryKey(displayedCategoryId), loadedItems, if (hasMore) Int.MAX_VALUE else loadedItems.size, lastRowId, focusedPosterKeys[memoryKey(displayedCategoryId)])
    }

    private fun memoryKey(categoryId: String? = selectedCategoryId) = "$providerId:$kind:${categoryId ?: ALL_CATEGORY_ID}"

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

    override fun onPause() { saveMemorySnapshot(); super.onPause() }
    override fun onDestroy() { pageJob?.cancel(); generation++; super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val PAGE_SIZE = 64
        private const val PREFETCH_THRESHOLD = 20
        private const val ALL_CATEGORY_ID = "__all__"
    }
}
