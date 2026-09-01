package tv.blofy.player.ui.catalog

import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/** v339 catalog composition backed by the current Room catalog. Categories stay on the right. */
class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private lateinit var search: EditText
    private var streamsJob: Job? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var currentRows: List<StreamEntity> = emptyList()
    private var initialFocusRequested = false
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = V339Ui.BLACK
        window.navigationBarColor = V339Ui.BLACK

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(6), dp(24), dp(20))
            background = V339Ui.screenGradient()
            clipChildren = false
            clipToPadding = false
        }

        val tools = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        countView = V339Ui.text(this, "", 12f, V339Ui.MUTED).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }
        tools.addView(countView, LinearLayout.LayoutParams(dp(220), dp(50)))
        search = V339Ui.input(this, "ابحث في ${if (kind == KIND_SERIES) "المسلسلات" else "الأفلام"}", false)
        tools.addView(search, LinearLayout.LayoutParams(0, dp(48), 1f))
        root.addView(tools, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
        }
        posterGrid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@PosterCatalogActivity, GRID_COLUMNS)
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 30)
            clipChildren = false
            clipToPadding = false
            setPadding(dp(8), 0, dp(4), dp(16))
            descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(content, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
            marginEnd = dp(12)
        })

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = V339Ui.panel(this@PosterCatalogActivity, android.graphics.Color.argb(205, 14, 12, 25), 16, V339Ui.STROKE)
        }
        rail.addView(V339Ui.title(this, "التصنيفات", 13f).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
            setPadding(dp(14), 0, dp(14), 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(45)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(5), dp(3), dp(5), dp(8))
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(rail, LinearLayout.LayoutParams(dp(224), ViewGroup.LayoutParams.MATCH_PARENT))

        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(onClick = ::openItem)
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryRemoteId(it)) },
            onFocus = { loadStreams(categoryRemoteId(it)) },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) = renderFiltered(s?.toString().orEmpty())
        })

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            providerId = provider.id
            dao.categories(provider.id, kind).collect { categories ->
                categoryRows = listOf(allCategory()) + categories
                categoryAdapter.submit(categoryRows)
                if (selectedCategoryId == null && streamsJob == null) loadStreams(null)
                if (!initialFocusRequested) {
                    initialFocusRequested = true
                    categoryList.post { requestCategoryFocus(0) }
                }
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> if (isFocusInside(categoryList) && requestPosterFocus()) return true
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (isFocusInside(posterGrid) && isAtRightGridEdge() && requestSelectedCategoryFocus()) return true
                KeyEvent.KEYCODE_DPAD_UP -> if (isFocusInside(posterGrid) && isOnFirstGridRow()) { search.requestFocus(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun loadStreams(categoryId: String?) {
        if (providerId.isBlank() || selectedCategoryId == categoryId && streamsJob?.isActive == true) return
        selectedCategoryId = categoryId
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(providerId, kind, categoryId).collect { items ->
                currentRows = items
                renderFiltered(search.text?.toString().orEmpty())
            }
        }
    }

    private fun renderFiltered(rawQuery: String) {
        val query = rawQuery.trim()
        val displayed = if (query.isBlank()) currentRows else currentRows.filter {
            it.name.contains(query, ignoreCase = true) ||
                it.genre?.contains(query, ignoreCase = true) == true ||
                it.year?.contains(query, ignoreCase = true) == true
        }
        posterAdapter.submit(displayed)
        countView.text = "${displayed.size} ${if (kind == KIND_SERIES) "مسلسل" else "فيلم"}"
    }

    private fun requestPosterFocus(): Boolean {
        if (posterAdapter.itemCount == 0) return false
        val existing = posterGrid.findViewHolderForAdapterPosition(0)?.itemView
        if (existing != null) return existing.requestFocus()
        posterGrid.scrollToPosition(0)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
        return true
    }

    private fun requestSelectedCategoryFocus(): Boolean {
        val targetId = selectedCategoryId
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

    private fun isAtRightGridEdge(): Boolean {
        val focused = currentFocus ?: return false
        val holder = posterGrid.findContainingViewHolder(focused) ?: return false
        val position = holder.bindingAdapterPosition
        if (position == RecyclerView.NO_POSITION) return false
        return position % GRID_COLUMNS == GRID_COLUMNS - 1 || position == posterAdapter.itemCount - 1
    }

    private fun isOnFirstGridRow(): Boolean {
        val focused = currentFocus ?: return false
        val holder = posterGrid.findContainingViewHolder(focused) ?: return false
        val position = holder.bindingAdapterPosition
        return position in 0 until GRID_COLUMNS
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
            putExtra(EXTRA_PROVIDER_ID_SHARED, providerId)
            putExtra(EXTRA_CONTENT_KEY_SHARED, stream.key)
        })
    }

    private fun allCategory() = CategoryEntity(
        "$providerId:$kind:$ALL_CATEGORY_ID",
        providerId,
        ALL_CATEGORY_ID,
        kind,
        if (kind == KIND_SERIES) "الكل  •  مسلسلات" else "الكل  •  أفلام",
        -1
    )

    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun dp(value: Int) = V339Ui.dp(this, value)
    override fun onDestroy() { streamsJob?.cancel(); super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val GRID_COLUMNS = 5
        private const val ALL_CATEGORY_ID = "__all__"
        private const val EXTRA_PROVIDER_ID_SHARED = "provider_id"
        private const val EXTRA_CONTENT_KEY_SHARED = "content_key"
    }
}
