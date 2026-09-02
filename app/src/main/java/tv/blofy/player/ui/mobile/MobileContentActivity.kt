package tv.blofy.player.ui.mobile

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
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
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class MobileContentActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categorySpinner: Spinner
    private lateinit var list: ListView
    private var categories: List<CategoryEntity> = emptyList()
    private var streams: List<StreamEntity> = emptyList()
    private var streamJob: Job? = null
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND) ?: KIND_LIVE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = AppCompatResources.getDrawable(this@MobileContentActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = when (kind) { KIND_MOVIE -> "الأفلام"; KIND_SERIES -> "المسلسلات"; else -> "البث المباشر" }
            textSize = 25f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            setPadding(dp(4), dp(3), 0, dp(12))
        })
        categorySpinner = Spinner(this).apply { background = fieldBackground() }
        list = ListView(this).apply {
            dividerHeight = dp(6)
            divider = null
            setBackgroundColor(Color.TRANSPARENT)
            selector = android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)
        }
        root.addView(categorySpinner, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)))
        root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(10) })
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { items ->
                categories = items
                categorySpinner.adapter = PremiumTextAdapter(items.map { it.name })
                if (items.isEmpty()) loadStreams(null) else loadStreams(items.first().remoteId)
            }
        }

        categorySpinner.setOnItemSelectedListener(SimpleItemSelectedListener { position -> categories.getOrNull(position)?.let { loadStreams(it.remoteId) } })
        list.setOnItemClickListener { _, _, position, _ -> streams.getOrNull(position)?.let(::openStream) }
        list.setOnItemLongClickListener { _, _, position, _ ->
            val stream = streams.getOrNull(position) ?: return@setOnItemLongClickListener false
            if (kind == KIND_LIVE && stream.archiveEnabled) { openCatchup(stream); true } else false
        }
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        streamJob?.cancel()
        streamJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->
                streams = items
                list.adapter = PremiumTextAdapter(items.map { it.name + if (kind == KIND_LIVE && it.archiveEnabled) "  •  أرشيف" else "" })
            }
        }
    }

    private inner class PremiumTextAdapter(values: List<String>) : ArrayAdapter<String>(this@MobileContentActivity, android.R.layout.simple_list_item_1, values) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View = style(super.getView(position, convertView, parent))
        override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View = style(super.getDropDownView(position, convertView, parent))
        private fun style(view: View): View = view.apply {
            (this as? TextView)?.apply {
                textSize = 16f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                setPadding(dp(18), dp(8), dp(18), dp(8))
                background = itemBackground()
            }
        }
    }

    private fun openStream(stream: StreamEntity) {
        when (kind) {
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply { putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply { putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key) })
            else -> {
                val profile = ProviderProfile(provider.id, if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                    putExtra(PlayerActivity.EXTRA_CATEGORY_ID, stream.categoryId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun openCatchup(stream: StreamEntity) {
        startActivity(Intent(this, CatchupActivity::class.java).apply { putExtra(CatchupActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(CatchupActivity.EXTRA_CONTENT_KEY, stream.key) })
    }

    private fun fieldBackground() = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat(); setColor(0xFF21182F.toInt()); setStroke(dp(1), 0xFF503C65.toInt())
    }
    private fun itemBackground() = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat(); setColor(0xFF21182F.toInt()); setStroke(dp(1), 0xFF463455.toInt())
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() { streamJob?.cancel(); super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
    }
}

private class SimpleItemSelectedListener(private val onSelected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) = onSelected(position)
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
}
