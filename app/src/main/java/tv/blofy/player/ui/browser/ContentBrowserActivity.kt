package tv.blofy.player.ui.browser

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity

class ContentBrowserActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var streamAdapter: FocusTextAdapter<StreamEntity>
    private var streamsJob: Job? = null
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND) ?: KIND_LIVE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(30, 22, 30, 22)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        val title = TextView(this).apply {
            text = when (kind) {
                KIND_MOVIE -> "الأفلام"
                KIND_SERIES -> "المسلسلات"
                else -> "البث المباشر"
            }
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(8, 0, 0, 18)
        }
        root.addView(title)

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val categories = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@ContentBrowserActivity) }
        val streams = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@ContentBrowserActivity) }
        body.addView(categories, LinearLayout.LayoutParams(300, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 18 })
        body.addView(streams, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        streamAdapter = FocusTextAdapter(label = { it.name }, onClick = ::openStream)
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(it.remoteId) },
            onFocus = { loadStreams(it.remoteId) }
        )
        categories.adapter = categoryAdapter
        streams.adapter = streamAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run {
                finish(); return@launch
            }
            dao.categories(provider.id, kind).collect { items ->
                categoryAdapter.submit(items)
                if (items.isEmpty()) loadStreams(null)
                else loadStreams(items.first().remoteId)
            }
        }
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect {
                streamAdapter.submit(it)
            }
        }
    }

    private fun openStream(stream: StreamEntity) {
        if (kind == KIND_SERIES) {
            startActivity(Intent(this, EpisodesActivity::class.java).apply {
                putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
            })
            return
        }
        lifecycleScope.launch {
            val profile = profile(provider)
            val url = if (kind == KIND_LIVE) ContentUrlResolver.live(provider, profile, stream)
            else ContentUrlResolver.movie(provider, stream)
            val resume = if (kind == KIND_MOVIE) {
                BlofyDatabase.get(applicationContext).dao().watchState(stream.key)?.positionMs ?: 0L
            } else 0L
            startActivity(Intent(this@ContentBrowserActivity, PlayerActivity::class.java).apply {
                putExtra(PlayerActivity.EXTRA_URL, url)
                putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(PlayerActivity.EXTRA_KIND, kind)
                putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            })
        }
    }

    private fun profile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (provider.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (provider.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects
    )

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
    }
}
