package tv.blofy.player.ui.mobile

import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catchup.CatchupActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class MobileContentActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categorySpinner: Spinner
    private lateinit var countView: TextView
    private var list: ListView? = null
    private var liveAdapter: MobileLiveAdapter? = null
    private lateinit var emptyView: TextView
    private var posterGrid: RecyclerView? = null
    private var posterAdapter: PosterStreamAdapter? = null
    private var categories: List<CategoryEntity> = emptyList()
    private var streams: List<StreamEntity> = emptyList()
    private var streamJob: Job? = null
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND) ?: KIND_LIVE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val compact = resources.configuration.screenWidthDp < 420
        val posterMode = kind == KIND_MOVIE || kind == KIND_SERIES
        val compact = resources.configuration.screenWidthDp < 400
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(if (compact) 12 else 18), dp(if (compact) 14 else 18), dp(if (compact) 12 else 18), dp(if (compact) 14 else 18))
            background = AppCompatResources.getDrawable(this@MobileContentActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = when (kind) { KIND_MOVIE -> "الأفلام"; KIND_SERIES -> "المسلسلات"; else -> "البث المباشر" }
            textSize = if (compact) 22f else 25f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(if (compact) 44 else 48), 1f))
        countView = TextView(this).apply {
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        header.addView(countView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(if (compact) 44 else 48)))
        root.addView(header)

        categorySpinner = Spinner(this)
        root.addView(categorySpinner, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (compact) 48 else 52)).apply {
            bottomMargin = dp(if (compact) 8 else 10)
        })

        emptyView = TextView(this).apply {
            text = "لا يوجد محتوى في هذا القسم"
            textSize = 15f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(0, dp(if (compact) 12 else 16), 0, dp(if (compact) 12 else 16))
        }
        root.addView(emptyView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        if (posterMode) {
            val posters = PosterStreamAdapter(onClick = ::openStream)
            posterAdapter = posters
            posterGrid = RecyclerView(this).apply {
                layoutManager = GridLayoutManager(this@MobileContentActivity, posterColumns())
                setPadding(dp(2), dp(4), dp(2), dp(if (compact) 18 else 26))
                clipChildren = false
                clipToPadding = false
                itemAnimator = null
                adapter = posters
            }
            root.addView(posterGrid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            val adapter = MobileLiveAdapter(this)
            liveAdapter = adapter
            list = ListView(this).apply {
                dividerHeight = 0
                setBackgroundColor(Color.TRANSPARENT)
                clipToPadding = false
                setPadding(0, dp(2), 0, dp(20))
                this.adapter = adapter
            }
            root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { items ->
                categories = items
                val adapter = ArrayAdapter(this@MobileContentActivity, android.R.layout.simple_spinner_item, items.map { it.name }).apply {
                    setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                }
                categorySpinner.adapter = adapter
                if (items.isEmpty()) loadStreams(null) else loadStreams(items.first().remoteId)
            }
        }

        categorySpinner.setOnItemSelectedListener(SimpleItemSelectedListener { position ->
            categories.getOrNull(position)?.let { loadStreams(it.remoteId) }
        })
        list?.setOnItemClickListener { _, _, position, _ -> streams.getOrNull(position)?.let(::openStream) }
        list?.setOnItemLongClickListener { _, _, position, _ ->
            val stream = streams.getOrNull(position) ?: return@setOnItemLongClickListener false
            if (kind == KIND_LIVE && stream.archiveEnabled) {
                openCatchup(stream)
                true
            } else false
        }
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        streamJob?.cancel()
        streamJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->
                streams = items
                countView.text = when (kind) {
                    KIND_MOVIE -> "${items.size} فيلم"
                    KIND_SERIES -> "${items.size} مسلسل"
                    else -> "${items.size} قناة"
                }
                emptyView.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                if (kind == KIND_LIVE) {
                    liveAdapter?.submit(items)
                } else {
                    posterAdapter?.submit(items)
                }
            }
        }
    }

    private fun openStream(stream: StreamEntity) {
        when (kind) {
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            else -> {
                val profile = ProviderProfile(provider.id, if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "live")
                    putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                    putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
                    putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_CATEGORY_ID, stream.categoryId)
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun openCatchup(stream: StreamEntity) {
        startActivity(Intent(this, CatchupActivity::class.java).apply {
            putExtra(CatchupActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatchupActivity.EXTRA_CONTENT_KEY, stream.key)
        })
    }

    private fun posterColumns(): Int {
        val widthDp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        return when {
            widthDp < 520f -> 2
            widthDp < 900f -> 4
            else -> 5
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        streamJob?.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
    }
}

private data class MobileLiveRowHolder(
    val artwork: ImageView,
    val title: TextView,
    val meta: TextView
)

private class MobileLiveAdapter(private val activity: MobileContentActivity) : BaseAdapter() {
    private var items: List<StreamEntity> = emptyList()

    fun submit(next: List<StreamEntity>) {
        items = next
        notifyDataSetChanged()
    }

    override fun getCount(): Int = items.size
    override fun getItem(position: Int): StreamEntity = items[position]
    override fun getItemId(position: Int): Long = position.toLong()

    override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
        val stream = getItem(position)
        val existing = convertView as? LinearLayout
        val row: LinearLayout
        val holder: MobileLiveRowHolder

        if (existing != null && existing.tag is MobileLiveRowHolder) {
            row = existing
            holder = existing.tag as MobileLiveRowHolder
        } else {
            row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = BlofyTvDesign.surface(dp(16).toFloat(), false)
            }
            val artwork = ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(BlofyTvDesign.Surface)
            }
            row.addView(artwork, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginStart = dp(12) })

            val textBox = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            }
            val title = TextView(activity).apply {
                textSize = 16.5f
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val meta = TextView(activity).apply {
                textSize = 12.5f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.RIGHT
                setPadding(0, dp(3), 0, 0)
            }
            textBox.addView(title)
            textBox.addView(meta)
            row.addView(textBox, LinearLayout.LayoutParams(0, dp(58), 1f))
            holder = MobileLiveRowHolder(artwork, title, meta)
            row.tag = holder
        }

        holder.title.text = stream.name
        holder.meta.text = if (stream.archiveEnabled) "بث مباشر  •  أرشيف متاح ⏱" else "بث مباشر"
        ArtworkLoader.load(holder.artwork, stream.icon)
        row.contentDescription = if (stream.archiveEnabled) "${stream.name}، أرشيف متاح" else stream.name
        return row
    }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
}

private class SimpleItemSelectedListener(private val onSelected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) = onSelected(position)
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
}
