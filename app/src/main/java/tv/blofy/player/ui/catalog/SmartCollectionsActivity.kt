package tv.blofy.player.ui.catalog

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

class SmartCollectionsActivity : AppCompatActivity() {
    private lateinit var adapter: PosterStreamAdapter
    private lateinit var titleView: TextView
    private lateinit var subtitleView: TextView
    private lateinit var countView: TextView
    private val mode by lazy { intent.getStringExtra(EXTRA_MODE).orEmpty().ifBlank { MODE_TOP_RATED } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(34), dp(24), dp(34), dp(28))
            background = AppCompatResources.getDrawable(this@SmartCollectionsActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        titleView = TextView(this).apply {
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        }
        subtitleView = TextView(this).apply {
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(3), 0, dp(10))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        copy.addView(titleView)
        copy.addView(subtitleView)
        header.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
        countView = TextView(this).apply {
            textSize = 12f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(12).toFloat())
        }
        header.addView(countView, LinearLayout.LayoutParams(-2, dp(38)))
        root.addView(header)

        val grid = RecyclerView(this).apply {
            layoutManager = GridLayoutManager(this@SmartCollectionsActivity, 5)
            setPadding(dp(4), dp(8), dp(4), dp(24))
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(20)
        }
        adapter = PosterStreamAdapter(::openItem)
        grid.adapter = adapter
        root.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        val labels = labelsFor(mode)
        titleView.text = labels.first
        subtitleView.text = labels.second

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() } ?: run { finish(); return@launch }
            val items = withContext(Dispatchers.IO) {
                val all = dao.allStreamsForProvider(provider.id).filter { it.kind == "movie" || it.kind == "series" }
                select(mode, all)
            }
            adapter.replace(items)
            countView.text = "${items.size} عنوان"
            ArtworkLoader.prefetch(this@SmartCollectionsActivity, items.take(24).map { it.icon ?: it.backdrop })
            grid.post { if (adapter.itemCount > 0) grid.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
        }
    }

    private fun select(mode: String, source: List<StreamEntity>): List<StreamEntity> = when (mode) {
        MODE_RECENT -> source.sortedWith(compareByDescending<StreamEntity> { it.addedAt ?: 0L }.thenBy { it.name }).take(180)
        MODE_TOP_RATED -> source.mapNotNull { item -> parseRating(item.rating)?.let { item to it } }
            .filter { it.second >= 6.0 }
            .sortedByDescending { it.second }
            .map { it.first }
            .take(180)
        MODE_4K -> source.filter { item ->
            val text = "${item.name} ${item.genre.orEmpty()} ${item.extension.orEmpty()} ${item.streamType.orEmpty()}".lowercase()
            listOf("4k", "uhd", "2160p", "2160").any(text::contains)
        }.sortedByDescending { it.addedAt ?: 0L }.take(180)
        MODE_ARABIC -> source.filter { item ->
            val text = "${item.name} ${item.genre.orEmpty()} ${item.plot.orEmpty()}"
            text.any { it in '\u0600'..'\u06FF' } || text.contains("arab", true)
        }.sortedByDescending { it.addedAt ?: 0L }.take(180)
        else -> source.sortedByDescending { parseRating(it.rating) ?: 0.0 }.take(180)
    }

    private fun parseRating(value: String?): Double? = value
        ?.replace(',', '.')
        ?.let { Regex("\\d+(?:\\.\\d+)?").find(it)?.value }
        ?.toDoubleOrNull()
        ?.takeIf { it in 0.0..10.0 }

    private fun openItem(stream: StreamEntity) {
        val target = if (stream.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
        startActivity(Intent(this, target).apply {
            putExtra("provider_id", stream.providerId)
            putExtra("content_key", stream.key)
        })
    }

    private fun labelsFor(mode: String) = when (mode) {
        MODE_RECENT -> "أضيف حديثًا" to "أحدث الأفلام والمسلسلات الموجودة في باقتك"
        MODE_TOP_RATED -> "الأعلى تقييمًا" to "أفضل العناوين حسب تقييمات المكتبة"
        MODE_4K -> "4K و UHD" to "المحتوى عالي الدقة الموجود في اشتراكك"
        MODE_ARABIC -> "محتوى عربي" to "أفلام ومسلسلات عربية من نفس الباقة"
        else -> "مختارات BLOFY" to "محتوى مختار من مكتبتك"
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_RECENT = "recent"
        const val MODE_TOP_RATED = "top_rated"
        const val MODE_4K = "4k"
        const val MODE_ARABIC = "arabic"
    }
}
