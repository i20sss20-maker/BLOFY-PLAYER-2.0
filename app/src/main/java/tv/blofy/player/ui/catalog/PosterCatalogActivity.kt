package tv.blofy.player.ui.catalog

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/** Dedicated TV catalog: server-order categories on the right, full poster grid on the left. */
class PosterCatalogActivity : AppCompatActivity() {
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var posterAdapter: PosterStreamAdapter
    private lateinit var categoryList: RecyclerView
    private lateinit var posterGrid: RecyclerView
    private lateinit var countView: TextView
    private var streamsJob: Job? = null
    private var providerId = ""
    private var selectedCategoryId: String? = null
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND).orEmpty().ifBlank { KIND_MOVIE } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(28), dp(22), dp(28), dp(24))
            background = AppCompatResources.getDrawable(this@PosterCatalogActivity, R.drawable.blofy_home_background)
            clipChildren = false; clipToPadding = false
        }

        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        header.addView(TextView(this).apply {
            text = if (kind == KIND_SERIES) "المسلسلات" else "الأفلام"
            textSize = 30f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.START
        }, LinearLayout.LayoutParams(0, dp(58), 1f))
        countView = TextView(this).apply { textSize = 14f; setTextColor(PURPLE_SOFT); gravity = Gravity.CENTER_VERTICAL }
        header.addView(countView)
        content.addView(header)

        posterGrid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@PosterCatalogActivity, 5)
            setPadding(dp(4), dp(4), dp(8), dp(22)); clipChildren = false; clipToPadding = false; itemAnimator = null
            setHasFixedSize(true)
            recycledViewPool.setMaxRecycledViews(0, 30)
        }
        content.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(18) })

        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP; layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(10), dp(14), dp(10), dp(14)); background = categoryBackground()
        }
        rail.addView(TextView(this).apply {
            text = "الفئات"; textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)))
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@PosterCatalogActivity, RecyclerView.VERTICAL, false)
            clipChildren = false; clipToPadding = false; itemAnimator = null; setHasFixedSize(true)
        }
        rail.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(rail, LinearLayout.LayoutParams(dp(250), LinearLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        posterAdapter = PosterStreamAdapter(onClick = ::openItem)
        posterGrid.adapter = posterAdapter
        categoryAdapter = FocusTextAdapter(label = { it.name }, onClick = { loadStreams(categoryRemoteId(it)) }, onFocus = { loadStreams(categoryRemoteId(it)) }, itemKey = { it.key })
        categoryList.adapter = categoryAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            providerId = provider.id
            dao.categories(provider.id, kind).collect { categories ->
                // Room rows already carry Xtream orderIndex. Never sort client-side.
                categoryAdapter.submit(listOf(allCategory()) + categories)
                if (selectedCategoryId == null) loadStreams(null)
                categoryList.post { categoryList.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            }
        }
    }

    private fun loadStreams(categoryId: String?) {
        if (providerId.isBlank() || selectedCategoryId == categoryId && streamsJob?.isActive == true) return
        selectedCategoryId = categoryId; streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(providerId, kind, categoryId).collect { items ->
                posterAdapter.submit(items)
                countView.text = "${items.size} ${if (kind == KIND_SERIES) "مسلسل" else "فيلم"}"
            }
        }
    }

    private fun openItem(stream: StreamEntity) {
        startActivity(Intent(this, if (kind == KIND_SERIES) SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra(EXTRA_PROVIDER_ID_SHARED, providerId); putExtra(EXTRA_CONTENT_KEY_SHARED, stream.key)
        })
    }

    private fun allCategory() = CategoryEntity("$providerId:$kind:$ALL_CATEGORY_ID", providerId, ALL_CATEGORY_ID, kind, if (kind == KIND_SERIES) "كل المسلسلات" else "كل الأفلام", -1)
    private fun categoryRemoteId(category: CategoryEntity) = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun categoryBackground() = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xE81A1429.toInt(), 0xF00C0A15.toInt())).apply { cornerRadius = dp(20).toFloat(); setStroke(dp(1), 0x594A355F) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onDestroy() { streamsJob?.cancel(); super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"; const val KIND_MOVIE = "movie"; const val KIND_SERIES = "series"
        private const val ALL_CATEGORY_ID = "__all__"; private const val EXTRA_PROVIDER_ID_SHARED = "provider_id"; private const val EXTRA_CONTENT_KEY_SHARED = "content_key"
        private val PURPLE_SOFT = Color.rgb(195, 135, 255)
    }
}
