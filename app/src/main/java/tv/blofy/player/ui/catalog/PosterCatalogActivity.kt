package tv.blofy.player.ui.catalog

import android.content.Intent
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
    private lateinit var emptyView: TextView
    private lateinit var searchInput: EditText
    private var streamsJob: Job? = null
    private var searchJob: Job? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var currentRows: List<StreamEntity> = emptyList()
    private var lastPosterKey: String? = null
    private var initialFocusRequested = false
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(24), dp(18), dp(24), dp(20))
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
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(214), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(16) })

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
            textSize = 29f
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(0, dp(56), 1f))
        countView = TextView(this).apply {
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(12), 0)
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)).apply { marginEnd = dp(10) })
        searchInput = EditText(this).apply {
            hint = "⌕  ابحث عن عنوان، سنة أو تصنيف"
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextMuted)
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(16), 0)
            background = searchBackground(false)
            isFocusable = true
            isFocusableInTouchMode = true
            setOnFocusChangeListener { view, focused ->
                view.background = searchBackground(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).translationZ(if (focused) dp(12).toFloat() else dp(1).toFloat()).setDuration(100).start()
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = runLocalSearch(s?.toString().orEmpty())
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        header.addView(searchInput, LinearLayout.LayoutParams(dp(320), dp(48)))
        content.addView(header)

        emptyView = TextView(this).apply {
            text = "جاري تجهيز المحتوى…"
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER
            visibility = View.VISIBLE
            setPadding(dp(24), dp(12), dp(24), dp(12))
            background = stateBackground()
        }
        content.addView(emptyView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(8); bottomMargin = dp(8) })

        posterGrid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@PosterCatalogActivity, GRID_COLUMNS)
            setPadding(dp(4), dp(6), dp(8), dp(24))
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 40)
            descendantFocusability = ViewGroupFocus.AFTER_DESCENDANTS
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(onClick = ::openItem, onFocus = { lastPosterKey = it.key })
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
                if (streamsJob == null) {
                    val initial = categories.firstOrNull()?.remoteId
                    selectedCategoryId = initial
                    loadStreams(initial)
                }
                if (!initialFocusRequested) {
                    initialFocusRequested = true
                    val initialPosition = if (categories.isNotEmpty()) 1 else 0
                    categoryList.post { requestCategoryFocus(initialPosition) }
                }
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (isFocusInside(categoryList) && requestPosterFocus()) return true
                KeyEvent.KEYCODE_DPAD_LEFT -> if (isFocusInside(posterGrid) && isAtLeftGridEdge() && requestSelectedCategoryFocus()) return true
                KeyEvent.KEYCODE_SEARCH -> { searchInput.requestFocus(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun loadStreams(categoryId: String?) {
        if (providerId.isBlank()) return
        if (selectedCategoryId == categoryId && streamsJob?.isActive == true) return
        selectedCategoryId = categoryId
        lastPosterKey = null
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
        if (providerId.isBlank()) return
        searchJob = lifecycleScope.launch {
            delay(35L)
            val filtered = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().searchCatalog(providerId, kind, query, MAX_SEARCH_RESULTS)
            }
            if (searchInput.text?.toString()?.trim() == query) showRows(filtered, searching = true)
        }
    }

    private fun showRows(items: List<StreamEntity>, searching: Boolean = false) {
        posterAdapter.submit(items)
        countView.text = when { searching -> "${items.size} نتيجة"; kind == KIND_SERIES -> "${items.size} مسلسل"; else -> "${items.size} فيلم" }
        val empty = items.isEmpty()
        emptyView.visibility = if (empty) View.VISIBLE else View.GONE
        emptyView.text = when {
            !empty -> ""
            searching -> "لا توجد نتائج لهذا البحث\nجرّب اسمًا أو سنة أو تصنيفًا آخر"
            kind == KIND_SERIES -> "لا توجد مسلسلات محفوظة في هذه الفئة\nيمكنك تحديث المحتوى يدويًا من الإعدادات"
            else -> "لا توجد أفلام محفوظة في هذه الفئة\nيمكنك تحديث المحتوى يدويًا من الإعدادات"
        }
    }

    private fun requestPosterFocus(): Boolean {
        if (posterAdapter.itemCount == 0) return false
        val remembered = lastPosterKey?.let { key -> currentRows.indexOfFirst { it.key == key }.takeIf { it >= 0 } }
        val target = remembered ?: 0
        val existing = posterGrid.findViewHolderForAdapterPosition(target)?.itemView
        if (existing != null) return existing.requestFocus()
        posterGrid.scrollToPosition(target)
        posterGrid.post { posterGrid.findViewHolderForAdapterPosition(target)?.itemView?.requestFocus() }
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

    private fun isAtLeftGridEdge(): Boolean {
        val focused = currentFocus ?: return false
        val holder = posterGrid.findContainingViewHolder(focused) ?: return false
        val position = holder.bindingAdapterPosition
        return position != RecyclerView.NO_POSITION && position % GRID_COLUMNS == 0
    }

    private fun isFocusInside(parent: View): Boolean {
        var child: View? = currentFocus
        while (child != null) { if (child === parent) return true; child = child.parent as? View }
        return false
    }

    private fun openItem(stream: StreamEntity) {
        if (providerId.isBlank()) return
        lastPosterKey = stream.key
        val target = if (stream.kind == KIND_SERIES || kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply { putExtra(EXTRA_PROVIDER_ID_SHARED, providerId); putExtra(EXTRA_CONTENT_KEY_SHARED, stream.key) })
    }

    private fun allCategory() = CategoryEntity("$providerId:$kind:$ALL_CATEGORY_ID", providerId, ALL_CATEGORY_ID, kind, if (kind == KIND_SERIES) "كل المسلسلات" else "كل الأفلام", -1)
    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun categoryBackground() = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
    private fun stateBackground() = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(0xFFF9F7FC.toInt()); setStroke(dp(1), BlofyTvDesign.Divider) }
    private fun searchBackground(focused: Boolean) = if (focused) BlofyTvDesign.surface(dp(17).toFloat(), true) else BlofyTvDesign.surface(dp(17).toFloat(), false)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() { streamsJob?.cancel(); searchJob?.cancel(); super.onDestroy() }
    private object ViewGroupFocus { const val AFTER_DESCENDANTS = 0x40000 }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val GRID_COLUMNS = 6
        private const val ALL_CATEGORY_ID = "__all__"
        private const val MAX_SEARCH_RESULTS = 300
        private const val EXTRA_PROVIDER_ID_SHARED = "provider_id"
        private const val EXTRA_CONTENT_KEY_SHARED = "content_key"
    }
}
