package tv.blofy.player.ui.mobile

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catchup.CatchupActivity
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
            setPadding(18, 18, 18, 18)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = when (kind) { KIND_MOVIE -> "الأفلام"; KIND_SERIES -> "المسلسلات"; else -> "البث المباشر" }
            textSize = 25f
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(4, 0, 0, 12)
        })
        categorySpinner = Spinner(this)
        list = ListView(this).apply {
            dividerHeight = 1
            setBackgroundColor(Color.TRANSPARENT)
        }
        root.addView(categorySpinner, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { items ->
                categories = items
                categorySpinner.adapter = ArrayAdapter(this@MobileContentActivity, android.R.layout.simple_spinner_dropdown_item, items.map { it.name })
                if (items.isEmpty()) loadStreams(null) else loadStreams(items.first().remoteId)
            }
        }

        categorySpinner.setOnItemSelectedListener(SimpleItemSelectedListener { position ->
            categories.getOrNull(position)?.let { loadStreams(it.remoteId) }
        })
        list.setOnItemClickListener { _, _, position, _ -> streams.getOrNull(position)?.let(::openStream) }
        list.setOnItemLongClickListener { _, _, position, _ ->
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
                list.adapter = ArrayAdapter(
                    this@MobileContentActivity,
                    android.R.layout.simple_list_item_1,
                    items.map { it.name + if (kind == KIND_LIVE && it.archiveEnabled) "  ⏱" else "" }
                )
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

private class SimpleItemSelectedListener(private val onSelected: (Int) -> Unit) : android.widget.AdapterView.OnItemSelectedListener {
    override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) = onSelected(position)
    override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
}
