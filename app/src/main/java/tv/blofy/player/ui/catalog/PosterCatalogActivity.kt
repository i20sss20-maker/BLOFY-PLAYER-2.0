package tv.blofy.player.ui.catalog

import android.content.Intent
import android.graphics.drawable.GradientDrawable
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

/** Dedicated TV catalog with incremental paging for very large providers. */
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
    private var loadingPage = false
    private var generation = 0
    private val statePrefs by lazy { getSharedPreferences("blofy_catalog_state", MODE_PRIVATE) }
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(24), dp(20), dp(24), dp(22))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(10), dp(12), dp(10), dp(12))
            background = categoryBackground()
            elevation = dp(4).toFloat()
        }
        rail.addView(TextView(this).apply {
            text = "الفئات"
            BlofyTvDesign.applyHeading(this)
            textSize = 18f
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity, RecyclerView.VERTICAL, false)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(220), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(18) })

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
            textSize = 30f
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(58), 1f))
        countView = TextView(this).apply {
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)))
        content.addView(header)

        val manager = GridLayoutManager(this, GRID_COLUMNS)
        posterGrid = RecyclerView(this).apply {
            layoutManager = manager
            setPadding(dp(4), dp(6), dp(8), dp(24))
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 36)
            setItemViewCacheSize(20)
            descendantFocusability = ViewGroupFocus.AFTER_DESCENDANTS
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    if (dy <= 0 || loadingPage || loadedItems.size >= totalItems) return
                    val last = manager.findLastVisibleItemPosition()
                    if (last >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
                }
            })
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(onClick = ::openItem, onFocus = { item ->
            rememberPoster(item)
            val index = loadedItems.indexOfFirst { it.key == item.key }
            if (index >= loadedItems.size - PREFETCH_THRESHOLD) loadNextPage()
        })
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryRemoteId(it), immediate = true) },
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
                    val initial = saved?.takeIf { id -> categories.any { it.remoteId == id } }
                    loadStreams(initial, immediate = true)
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
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (isFocusInside(categoryList) && requestPosterFocus()) return true
                KeyEvent.KEYCODE_DPAD_LEFT -> if (isFocusInside(posterGrid) && isAtLeftGridEdge() && requestSelectedCategoryFocus()) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun scheduleCategoryLoad(categoryId: String?) {
        if (providerId.isBlank() || selectedCategoryId == categoryId) return
        categoryFocusJob?.cancel()
        categoryFocusJob = lifecycleScope.launch {
            delay(90L)
            loadStreams(categoryId, immediate = false)
        }
    }

    private fun loadStreams(categoryId: String?, immediate: Boolean) {
        if (providerId.isBlank()) return
        if (immediate) categoryFocusJob?.cancel()
        if (selectedCategoryId == categoryId && loadedItems.isNotEmpty()) return
        selectedCategoryId = categoryId
        rememberCategory(categoryId)
        generation += 1
        pageJob?.cancel()
        loadedItems.clear()
        totalItems = 0
        loadingPage = false
        posterAdapter.replace(emptyList())
        countView.text = "..."
        loadNextPage(reset = true)
    }

    private fun loadNextPage(reset: Boolean = false) {
        if (providerId.isBlank() || loadingPage) return
        if (!reset && totalItems > 0 && loadedItems.size >= totalItems) return
        val requestGeneration = generation
        val offset = if (reset) 0 else loadedItems.size
        loadingPage = true
        pageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val categoryId = selectedCategoryId
            val result = withContext(Dispatchers.IO) {
                val total = if (categoryId == null) dao.catalogCountAll(providerId, kind)
                else dao.catalogCountInCategory(providerId, kind, categoryId)
                val page = if (categoryId == null) dao.catalogPageAll(providerId, kind, PAGE_SIZE, offset)
                else dao.catalogPageInCategory(providerId, kind, categoryId, PAGE_SIZE, offset)
                total to page
            }
            if (requestGeneration != generation) return@launch
            totalItems = result.first
            if (offset == 0) {
                loadedItems.clear()
                loadedItems.addAll(result.second)
                posterAdapter.replace(result.second)
            } else {
                loadedItems.addAll(result.second)
                posterAdapter.append(result.second)
            }
            countView.text = "${loadedItems.size} / $totalItems ${if (kind == KIND_SERIES) "مسلسل" else "فيلم"}"
            if (result.second.isNotEmpty()) {
                ArtworkLoader.prefetch(this@PosterCatalogActivity, result.second.take(24).map { it.icon ?: it.backdrop })
            }
            loadingPage = false
            if (offset == 0) restoreSavedPosterIfVisible()
        }.also { job ->
            job.invokeOnCompletion {
                if (requestGeneration == generation) runOnUiThread { loadingPage = false }
            }
        }
    }

    private fun restoreSavedPosterIfVisible() {
        val key = savedPosterKey() ?: return
        val index = loadedItems.indexOfFirst { it.key == key }
        if (index < 0) return
        posterGrid.scrollToPosition(index)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }

    private fun requestPosterFocus(): Boolean {
        if (posterAdapter.itemCount == 0) return false
        val saved = savedPosterKey()
        val index = saved?.let { key -> loadedItems.indexOfFirst { it.key == key } }?.takeIf { it >= 0 } ?: 0
        val existing = posterGrid.findViewHolderForAdapterPosition(index)?.itemView
        if (existing != null) return existing.requestFocus()
        posterGrid.scrollToPosition(index)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }

    private fun requestSelectedCategoryFocus(): Boolean {
        if (!::categoryAdapter.isInitialized || categoryAdapter.itemCount == 0) return false
        val targetId = selectedCategoryId ?: savedCategoryId()
        val position = categoryRows.indexOfFirst { categoryRemoteId(it) == targetId }.takeIf { it >= 0 } ?: 0
        return requestCategoryFocus(position)
    }

    private fun requestCategoryFocus(position: Int): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val safe = position.coerceIn(0, categoryAdapter.itemCount - 1)
        val existing = categoryList.findViewHolderForAdapterPosition(safe)?.itemView
        if (existing != null) return existing.requestFocus()
        categoryList.scrollToPosition(safe)
        categoryList.post { categoryList.findViewHolderForAdapterPosition(safe)?.itemView?.requestFocus() }
        return true
    }

    private fun isAtLeftGridEdge(): Boolean {
        val focused = currentFocus ?: return false
        val holder = posterGrid.findContainingViewHolder(focused) ?: return false
        val position = holder.bindingAdapterPosition
        return position != RecyclerView.NO_POSITION && position % GRID_COLUMNS == 0
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
        startActivity(Intent(this, if (kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra(EXTRA_PROVIDER_ID_SHARED, providerId)
            putExtra(EXTRA_CONTENT_KEY_SHARED, stream.key)
        })
    }

    private fun rememberCategory(categoryId: String?) {
        if (providerId.isBlank()) return
        val editor = statePrefs.edit()
        if (categoryId == null) editor.remove(categoryStateKey()) else editor.putString(categoryStateKey(), categoryId)
        editor.apply()
    }

    private fun rememberPoster(stream: StreamEntity) {
        if (providerId.isBlank()) return
        statePrefs.edit().putString(posterStateKey(), stream.key).apply()
    }

    private fun savedCategoryId(): String? = if (providerId.isBlank()) null else statePrefs.getString(categoryStateKey(), null)
    private fun savedPosterKey(): String? = if (providerId.isBlank()) null else statePrefs.getString(posterStateKey(), null)
    private fun categoryStateKey() = "$providerId:$kind:last_category"
    private fun posterStateKey() = "$providerId:$kind:last_poster"

    private fun allCategory() = CategoryEntity("$providerId:$kind:$ALL_CATEGORY_ID", providerId, ALL_CATEGORY_ID, kind, if (kind == KIND_SERIES) "كل المسلسلات" else "كل الأفلام", -1)
    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun categoryBackground() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF241A36.toInt(), 0xFF171122.toInt())).apply {
        cornerRadius = dp(22).toFloat()
        setStroke(dp(1), 0xFF49375E.toInt())
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        categoryFocusJob?.cancel()
        pageJob?.cancel()
        generation += 1
        super.onDestroy()
    }

    private object ViewGroupFocus { const val AFTER_DESCENDANTS = 0x40000 }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val GRID_COLUMNS = 5
        private const val PAGE_SIZE = 240
        private const val PREFETCH_THRESHOLD = 55
        private const val ALL_CATEGORY_ID = "__all__"
        private const val EXTRA_PROVIDER_ID_SHARED = "provider_id"
        private const val EXTRA_CONTENT_KEY_SHARED = "content_key"
    }
}
