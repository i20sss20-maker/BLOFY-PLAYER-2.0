package tv.blofy.player.ui.catalog

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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private var pageJob: Job? = null
    private var categoryFocusJob: Job? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var initialFocusRequested = false
    private val loadedItems = ArrayList<StreamEntity>(128)
    private var hasMore = true
    private var lastRowId = 0L
    private var loadingPage = false
    private var generation = 0
    private var gridColumns = 6
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
            DeviceClass.Kind.TV -> 208
            DeviceClass.Kind.TABLET -> 168
            DeviceClass.Kind.PHONE -> 108
        }
        val railGap = when (deviceKind) {
            DeviceClass.Kind.TV -> 16
            DeviceClass.Kind.TABLET -> 12
            DeviceClass.Kind.PHONE -> 6
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(outerPadding), dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 16), dp(outerPadding), dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 18))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 5 else 9), dp(8), dp(if (deviceKind == DeviceClass.Kind.PHONE) 5 else 9), dp(8))
            background = BlofyTvDesign.glassSurface(dp(if (deviceKind == DeviceClass.Kind.PHONE) 14 else 20).toFloat())
            elevation = dp(2).toFloat()
        }
        rail.addView(TextView(this).apply {
            text = getString(R.string.categories)
            BlofyTvDesign.applyHeading(this)
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 13f else 17f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (deviceKind == DeviceClass.Kind.PHONE) 38 else 44)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(16)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(railWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(railGap) })

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
                DeviceClass.Kind.TV -> 28f
                DeviceClass.Kind.TABLET -> 24f
                DeviceClass.Kind.PHONE -> 20f
            }
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 46 else 54), 1f))
        countView = TextView(this).apply {
            textSize = if (deviceKind == DeviceClass.Kind.PHONE) 10.5f else 12f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0, dp(if (deviceKind == DeviceClass.Kind.PHONE) 8 else 12), 0)
            background = BlofyTvDesign.badge(dp(11).toFloat())
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(if (deviceKind == DeviceClass.Kind.PHONE) 32 else 36)))
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
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    if (dy <= 0 || loadingPage || !hasMore) return
                    if (manager.findLastVisibleItemPosition() >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
                }
            })
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(::openItem) { item ->
            val index = loadedItems.indexOfFirst { it.key == item.key }
            if (index >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
        }
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryRemoteId(it), true) },
            onFocus = { scheduleCategoryLoad(categoryRemoteId(it)) },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            providerId = provider.id
            dao.categories(provider.id, kind).collect { categories ->
                categoryRows = listOf(allCategory()) + categories
                categoryAdapter.submit(categoryRows)
                if (loadedItems.isEmpty() && pageJob == null) loadStreams(null, true)
                if (!initialFocusRequested) {
                    initialFocusRequested = true
                    categoryList.post { requestSelectedCategoryFocus() }
                }
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && isFocusInside(categoryList) && requestPosterFocus()) return true
            if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT && isFocusInside(posterGrid) && isAtLeftGridEdge() && requestSelectedCategoryFocus()) return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun scheduleCategoryLoad(id: String?) {
        if (providerId.isBlank() || selectedCategoryId == id) return
        categoryFocusJob?.cancel()
        categoryFocusJob = lifecycleScope.launch {
            delay(45)
            loadStreams(id, false)
        }
    }

    private fun loadStreams(id: String?, immediate: Boolean) {
        if (providerId.isBlank()) return
        if (immediate) categoryFocusJob?.cancel()
        if (selectedCategoryId == id && loadedItems.isNotEmpty()) return
        selectedCategoryId = id
        generation++
        pageJob?.cancel()
        loadedItems.clear()
        hasMore = true
        lastRowId = 0L
        loadingPage = false
        val cached = CatalogPageMemory.get(memoryKey())
        if (cached != null && cached.items.isNotEmpty()) {
            loadedItems.addAll(cached.items)
            lastRowId = cached.lastRowId
            hasMore = cached.items.size >= PAGE_SIZE
            posterAdapter.replace(cached.items)
            updateCount()
            return
        }
        posterAdapter.replace(emptyList())
        countView.text = "..."
        loadNextPage(true)
    }

    private fun loadNextPage(reset: Boolean = false) {
        if (providerId.isBlank() || loadingPage || (!reset && !hasMore)) return
        val requestGeneration = generation
        val cursor = if (reset) 0L else lastRowId
        loadingPage = true
        pageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val categoryId = selectedCategoryId
            val result = withContext(Dispatchers.IO) {
                val page = if (categoryId == null) {
                    dao.catalogPageAfterAll(providerId, kind, cursor, PAGE_SIZE)
                } else {
                    dao.catalogPageAfterInCategory(providerId, kind, categoryId, cursor, PAGE_SIZE)
                }
                page to (page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor)
            }
            if (requestGeneration != generation) return@launch
            lastRowId = result.second
            hasMore = result.first.size >= PAGE_SIZE
            if (reset) {
                loadedItems.clear()
                loadedItems.addAll(result.first)
                posterAdapter.replace(result.first)
            } else {
                loadedItems.addAll(result.first)
                posterAdapter.append(result.first)
            }
            updateCount()
            ArtworkLoader.prefetch(this@PosterCatalogActivity, result.first.take(18).map { it.icon ?: it.backdrop })
            loadingPage = false
            saveMemorySnapshot()
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
        if (providerId.isNotBlank() && loadedItems.isNotEmpty()) {
            CatalogPageMemory.put(memoryKey(), loadedItems, if (hasMore) Int.MAX_VALUE else loadedItems.size, lastRowId, null)
        }
    }

    private fun memoryKey() = "$providerId:$kind:${selectedCategoryId ?: ALL_CATEGORY_ID}"

    private fun requestPosterFocus(): Boolean {
        if (posterAdapter.itemCount == 0) return false
        posterGrid.scrollToPosition(0)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
        return true
    }

    private fun requestSelectedCategoryFocus(): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val position = categoryRows.indexOfFirst { categoryRemoteId(it) == selectedCategoryId }.takeIf { it >= 0 } ?: 0
        categoryList.scrollToPosition(position)
        categoryList.post { categoryList.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus() }
        return true
    }

    private fun isAtLeftGridEdge(): Boolean {
        val holder = posterGrid.findContainingViewHolder(currentFocus ?: return false) ?: return false
        return holder.bindingAdapterPosition != RecyclerView.NO_POSITION && holder.bindingAdapterPosition % gridColumns == 0
    }

    private fun isFocusInside(parent: View): Boolean {
        var child: View? = currentFocus
        while (child != null) {
            if (child === parent) return true
            child = child.parent as? View
        }
        return false
    }

    private fun openItem(stream: StreamEntity) {
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
    override fun onDestroy() { categoryFocusJob?.cancel(); pageJob?.cancel(); generation++; super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val PAGE_SIZE = 96
        private const val PREFETCH_THRESHOLD = 28
        private const val ALL_CATEGORY_ID = "__all__"
    }
}
