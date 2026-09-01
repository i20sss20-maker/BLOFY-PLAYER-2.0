package tv.blofy.player.ui.catalog

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
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
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private lateinit var emptyView: TextView
    private lateinit var searchInput: EditText
    private var streamsJob: Job? = null
    private var searchJob: Job? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var currentRows: List<StreamEntity> = emptyList()
    private var initialFocusRequested = false
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(24), dp(18), dp(24), dp(20))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false; clipToPadding = false
        }

        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        header.addView(TextView(this).apply {
            text = if (kind == KIND_SERIES) "المسلسلات" else "الأفلام"
            textSize = 30f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(58), 1f))
        countView = TextView(this).apply {
            textSize = 14f; setTextColor(PURPLE_SOFT); gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0)
        }
        header.addView(countView)
        searchInput = EditText(this).apply {
            hint = "⌕  بحث من أول حرف"
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setTextColor(Color.WHITE)
            setHintTextColor(0xFFAF9BBB.toInt())
            textSize = 15f
            setPadding(dp(16), 0, dp(16), 0)
            background = searchBackground(false)
            isFocusable = true
            setOnFocusChangeListener { view, focused -> view.background = searchBackground(focused) }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = runLocalSearch(s?.toString().orEmpty())
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        header.addView(searchInput, LinearLayout.LayoutParams(dp(320), dp(50)))
        content.addView(header)

        emptyView = TextView(this).apply {
            textSize = 15f; setTextColor(Color.rgb(190, 173, 210)); gravity = Gravity.RIGHT; visibility = View.GONE
            setPadding(dp(8), 0, dp(8), dp(8))
        }
        content.addView(emptyView)

        posterGrid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@PosterCatalogActivity, GRID_COLUMNS)
            setPadding(dp(4), dp(4), dp(8), dp(22)); clipChildren = false; clipToPadding = false; itemAnimator = null
            setHasFixedSize(true); recycledViewPool.setMaxRecycledViews(0, 40); descendantFocusability = ViewGroupFocus.AFTER_DESCENDANTS
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(16) })

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP; layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(9), dp(12), dp(9), dp(12)); background = categoryBackground()
        }
        rail.addView(TextView(this).apply {
            text = "الفئات"; textSize = 19f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity, RecyclerView.VERTICAL, false)
            clipChildren = false; clipToPadding = false; itemAnimator = null; setHasFixedSize(true)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(238), LinearLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(onClick = ::openItem)
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryRemoteId(it)) },
            onFocus = { if (searchInput.text.isNullOrBlank()) loadStreams(categoryRemoteId(it)) },
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
                KeyEvent.KEYCODE_SEARCH -> { searchInput.requestFocus(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun loadStreams(categoryId: String?) {
        if (providerId.isBlank()) return
        if (selectedCategoryId == categoryId && streamsJob?.isActive == true) return
        selectedCategoryId = categoryId
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(providerId, kind, categoryId).collect { items ->
                currentRows = items
                if (searchInput.text.isNullOrBlank()) showRows(items)
            }
        }
    }

    private fun runLocalSearch(raw: String) {
        searchJob?.cancel()
        val query = raw.trim()
        if (query.isEmpty()) { showRows(currentRows); return }
        searchJob = lifecycleScope.launch {
            delay(50L)
            val all = withContext(Dispatchers.IO) { BlofyDatabase.get(applicationContext).dao().streams(providerId, kind, null).first() }
            val filtered = withContext(Dispatchers.Default) {
                all.asSequence().filter { row ->
                    row.name.contains(query, true) || row.genre?.contains(query, true) == true || row.year?.contains(query, true) == true
                }.take(700).toList()
            }
            if (searchInput.text?.toString()?.trim() == query) showRows(filtered, searching = true)
        }
    }

    private fun showRows(items: List<StreamEntity>, searching: Boolean = false) {
        posterAdapter.submit(items)
        countView.text = when {
            searching -> "${items.size} نتيجة"
            kind == KIND_SERIES -> "${items.size} مسلسل"
            else -> "${items.size} فيلم"
        }
        emptyView.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        emptyView.text = if (items.isEmpty()) {
            if (searching) "لا توجد نتائج" else "لا يوجد محتوى محفوظ في هذه الفئة • التحديث يدوي فقط من الإعدادات"
        } else ""
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
        val position = categoryRows.indexOfFirst { categoryRemoteId(it) == selectedCategoryId }.takeIf { it >= 0 } ?: 0
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
        return position != RecyclerView.NO_POSITION && (position % GRID_COLUMNS == GRID_COLUMNS - 1 || position == posterAdapter.itemCount - 1)
    }

    private fun isFocusInside(parent: View): Boolean {
        var child: View? = currentFocus
        while (child != null) { if (child === parent) return true; child = child.parent as? View }
        return false
    }

    private fun openItem(stream: StreamEntity) {
        if (providerId.isBlank()) return
        val target = if (stream.kind == KIND_SERIES || kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply {
            putExtra(EXTRA_PROVIDER_ID_SHARED, providerId)
            putExtra(EXTRA_CONTENT_KEY_SHARED, stream.key)
        })
    }

    private fun allCategory() = CategoryEntity("$providerId:$kind:$ALL_CATEGORY_ID", providerId, ALL_CATEGORY_ID, kind, if (kind == KIND_SERIES) "كل المسلسلات" else "كل الأفلام", -1)
    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun categoryBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xE81A1429.toInt(), 0xF00C0A15.toInt())).apply { cornerRadius = dp(20).toFloat(); setStroke(dp(1), 0x594A355F) }
    private fun searchBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF9140DF.toInt(), 0xFF6420BE.toInt()) else intArrayOf(0xDD25152F.toInt(), 0xE6150D1D.toInt())
    ).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x665D3E79) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() { streamsJob?.cancel(); searchJob?.cancel(); super.onDestroy() }

    private object ViewGroupFocus { const val AFTER_DESCENDANTS = 0x40000 }

    companion object {
        const val EXTRA_KIND = "kind"; const val KIND_MOVIE = "movie"; const val KIND_SERIES = "series"
        private const val GRID_COLUMNS = 6
        private const val ALL_CATEGORY_ID = "__all__"
        private const val EXTRA_PROVIDER_ID_SHARED = "provider_id"; private const val EXTRA_CONTENT_KEY_SHARED = "content_key"
        private val PURPLE_SOFT = Color.rgb(195, 135, 255)
    }
}
