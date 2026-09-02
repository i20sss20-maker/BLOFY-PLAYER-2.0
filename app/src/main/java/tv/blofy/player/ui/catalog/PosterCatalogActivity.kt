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
    private val loadedItems = ArrayList<StreamEntity>(256)
    private var totalItems = 0
    private var lastRowId = 0L
    private var loadingPage = false
    private var generation = 0
    private val statePrefs by lazy { getSharedPreferences("blofy_catalog_state", MODE_PRIVATE) }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(28), dp(22), dp(28), dp(24))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(12), dp(14), dp(12), dp(14))
            background = BlofyTvDesign.glassSurface(dp(22).toFloat())
            elevation = dp(4).toFloat()
        }
        rail.addView(TextView(this).apply {
            text = "الفئات"
            BlofyTvDesign.applyHeading(this)
            textSize = 19f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(18)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(250), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(24) })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        header.addView(TextView(this).apply {
            text = if (kind == KIND_SERIES) "المسلسلات" else "الأفلام"
            BlofyTvDesign.applyTitle(this)
            textSize = 32f
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(64), 1f))
        countView = TextView(this).apply {
            textSize = 13f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(12).toFloat())
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)))
        content.addView(header)

        val manager = GridLayoutManager(this, GRID_COLUMNS)
        posterGrid = RecyclerView(this).apply {
            layoutManager = manager
            setPadding(dp(6), dp(8), dp(10), dp(28))
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 32)
            setItemViewCacheSize(18)
            descendantFocusability = 0x40000
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    if (dy <= 0 || loadingPage || loadedItems.size >= totalItems) return
                    if (manager.findLastVisibleItemPosition() >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
                }
            })
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(::openItem) { item ->
            rememberPoster(item)
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
                if (selectedCategoryId == null && loadedItems.isEmpty() && pageJob == null) {
                    val saved = savedCategoryId()
                    loadStreams(saved?.takeIf { id -> categories.any { it.remoteId == id } }, true)
                }
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
            delay(90)
            loadStreams(id, false)
        }
    }

    private fun loadStreams(id: String?, immediate: Boolean) {
        if (providerId.isBlank()) return
        if (immediate) categoryFocusJob?.cancel()
        if (selectedCategoryId == id && loadedItems.isNotEmpty()) return
        saveMemorySnapshot()
        selectedCategoryId = id
        rememberCategory(id)
        generation++
        pageJob?.cancel()
        loadedItems.clear()
        totalItems = 0
        lastRowId = 0L
        loadingPage = false
        val cached = CatalogPageMemory.get(memoryKey())
        if (cached != null && cached.items.isNotEmpty()) {
            loadedItems.addAll(cached.items)
            totalItems = cached.total
            lastRowId = cached.lastRowId
            posterAdapter.replace(cached.items)
            updateCount()
            (cached.focusedKey ?: savedPosterKey())?.let(::restorePosterKeyIfLoaded)
            return
        }
        posterAdapter.replace(emptyList())
        countView.text = "..."
        loadNextPage(true)
    }

    private fun loadNextPage(reset: Boolean = false) {
        if (providerId.isBlank() || loadingPage) return
        if (!reset && totalItems > 0 && loadedItems.size >= totalItems) return
        val requestGeneration = generation
        val cursor = if (reset) 0L else lastRowId
        loadingPage = true
        pageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val categoryId = selectedCategoryId
            val result = withContext(Dispatchers.IO) {
                val total = if (categoryId == null) dao.catalogCountAll(providerId, kind)
                else dao.catalogCountInCategory(providerId, kind, categoryId)
                val page = if (categoryId == null) dao.catalogPageAfterAll(providerId, kind, cursor, PAGE_SIZE)
                else dao.catalogPageAfterInCategory(providerId, kind, categoryId, cursor, PAGE_SIZE)
                Triple(total, page, page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor)
            }
            if (requestGeneration != generation) return@launch
            totalItems = result.first
            lastRowId = result.third
            if (reset) {
                loadedItems.clear()
                loadedItems.addAll(result.second)
                posterAdapter.replace(result.second)
            } else {
                loadedItems.addAll(result.second)
                posterAdapter.append(result.second)
            }
            updateCount()
            ArtworkLoader.prefetch(this@PosterCatalogActivity, result.second.take(24).map { it.icon ?: it.backdrop })
            loadingPage = false
            saveMemorySnapshot()
            if (reset) restoreSavedPosterIfVisible()
        }.also { job ->
            job.invokeOnCompletion {
                if (requestGeneration == generation) runOnUiThread { loadingPage = false }
            }
        }
    }

    private fun updateCount() {
        countView.text = "${loadedItems.size} / $totalItems ${if (kind == KIND_SERIES) "مسلسل" else "فيلم"}"
    }

    private fun saveMemorySnapshot() {
        if (providerId.isNotBlank() && loadedItems.isNotEmpty()) CatalogPageMemory.put(memoryKey(), loadedItems, totalItems, lastRowId, savedPosterKey())
    }

    private fun memoryKey() = "$providerId:$kind:${selectedCategoryId ?: ALL_CATEGORY_ID}"
    private fun restoreSavedPosterIfVisible() { savedPosterKey()?.let(::restorePosterKeyIfLoaded) }
    private fun restorePosterKeyIfLoaded(key: String) {
        val index = loadedItems.indexOfFirst { it.key == key }
        if (index < 0) return
        posterGrid.scrollToPosition(index)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }
    private fun requestPosterFocus(): Boolean {
        if (posterAdapter.itemCount == 0) return false
        val index = savedPosterKey()?.let { key -> loadedItems.indexOfFirst { it.key == key } }?.takeIf { it >= 0 } ?: 0
        posterGrid.scrollToPosition(index)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }
    private fun requestSelectedCategoryFocus(): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val id = selectedCategoryId ?: savedCategoryId()
        val position = categoryRows.indexOfFirst { categoryRemoteId(it) == id }.takeIf { it >= 0 } ?: 0
        categoryList.scrollToPosition(position)
        categoryList.post { categoryList.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus() }
        return true
    }
    private fun isAtLeftGridEdge(): Boolean {
        val holder = posterGrid.findContainingViewHolder(currentFocus ?: return false) ?: return false
        return holder.bindingAdapterPosition != RecyclerView.NO_POSITION && holder.bindingAdapterPosition % GRID_COLUMNS == 0
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
        rememberPoster(stream)
        saveMemorySnapshot()
        startActivity(Intent(this, if (kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra("provider_id", providerId)
            putExtra("content_key", stream.key)
        })
    }
    private fun rememberCategory(id: String?) {
        if (providerId.isBlank()) return
        statePrefs.edit().apply { if (id == null) remove(categoryStateKey()) else putString(categoryStateKey(), id) }.apply()
    }
    private fun rememberPoster(stream: StreamEntity) { statePrefs.edit().putString(posterStateKey(), stream.key).apply() }
    private fun savedCategoryId() = if (providerId.isBlank()) null else statePrefs.getString(categoryStateKey(), null)
    private fun savedPosterKey() = if (providerId.isBlank()) null else statePrefs.getString(posterStateKey(), null)
    private fun categoryStateKey() = "$providerId:$kind:last_category"
    private fun posterStateKey() = "$providerId:$kind:last_poster"
    private fun allCategory() = CategoryEntity("$providerId:$kind:$ALL_CATEGORY_ID", providerId, ALL_CATEGORY_ID, kind, if (kind == KIND_SERIES) "كل المسلسلات" else "كل الأفلام", -1)
    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onPause() { saveMemorySnapshot(); super.onPause() }
    override fun onDestroy() { categoryFocusJob?.cancel(); pageJob?.cancel(); generation++; super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val GRID_COLUMNS = 4
        private const val PAGE_SIZE = 200
        private const val PREFETCH_THRESHOLD = 44
        private const val ALL_CATEGORY_ID = "__all__"
    }
}
