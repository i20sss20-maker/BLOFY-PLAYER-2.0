package tv.blofy.player.ui.browser

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.BlofyPlaybackSession
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

@OptIn(markerClass = [UnstableApi::class])
class ContentBrowserActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var streamAdapter: FocusTextAdapter<StreamEntity>
    private var streamsJob: Job? = null
    private var previewJob: Job? = null
    private var previewSession: BlofyPlaybackSession? = null
    private var previewView: PlayerView? = null
    private var previewTitle: TextView? = null
    private var currentCategoryId: String? = null
    private var lastPreviewKey: String? = null
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
        body.addView(categories, LinearLayout.LayoutParams(280, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 18 })

        if (kind == KIND_LIVE) {
            body.addView(streams, LinearLayout.LayoutParams(360, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 22 })
            body.addView(createPreviewPanel(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        } else {
            body.addView(streams, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        }

        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        streamAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = ::openStream,
            onFocus = { if (kind == KIND_LIVE) schedulePreview(it) }
        )
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

    private fun createPreviewPanel(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(18, 18, 18, 18)
        setBackgroundColor(Color.rgb(12, 10, 20))

        previewTitle = TextView(this@ContentBrowserActivity).apply {
            text = "المعاينة"
            textSize = 21f
            setTextColor(Color.WHITE)
            setPadding(4, 0, 0, 12)
        }
        addView(previewTitle)

        previewView = PlayerView(this@ContentBrowserActivity).apply {
            useController = false
            player = null
            isFocusable = false
            setShutterBackgroundColor(Color.BLACK)
        }
        addView(previewView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        addView(TextView(this@ContentBrowserActivity).apply {
            text = "OK: ملء الشاشة   •   ↑↓: تنقل بين القنوات"
            textSize = 14f
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(4, 14, 0, 0)
        })
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        currentCategoryId = categoryId
        lastPreviewKey = null
        stopPreview()
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->
                streamAdapter.submit(items)
                if (kind == KIND_LIVE && items.isNotEmpty()) schedulePreview(items.first(), immediate = true)
            }
        }
    }

    private fun schedulePreview(stream: StreamEntity, immediate: Boolean = false) {
        if (!::provider.isInitialized || kind != KIND_LIVE || stream.key == lastPreviewKey) return
        previewJob?.cancel()
        previewJob = lifecycleScope.launch {
            if (!immediate) delay(220)
            startPreview(stream)
        }
    }

    private fun startPreview(stream: StreamEntity) {
        val profile = profile(provider)
        val url = ContentUrlResolver.live(provider, profile, stream)
        if (previewSession == null) {
            previewSession = BlofyPlaybackSession(this, profile, "live_preview")
            previewView?.player = previewSession?.player
        }
        lastPreviewKey = stream.key
        previewTitle?.text = stream.name
        previewSession?.play(url)
    }

    private fun stopPreview() {
        previewJob?.cancel()
        previewView?.player = null
        previewSession?.release()
        previewSession = null
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
            if (kind == KIND_LIVE) stopPreview()
            startActivity(Intent(this@ContentBrowserActivity, PlayerActivity::class.java).apply {
                putExtra(PlayerActivity.EXTRA_URL, url)
                putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(PlayerActivity.EXTRA_KIND, kind)
                putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
                putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                putExtra(PlayerActivity.EXTRA_CATEGORY_ID, currentCategoryId)
                putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
            })
        }
    }

    override fun onResume() {
        super.onResume()
        if (kind == KIND_LIVE && ::provider.isInitialized) lastPreviewKey = null
    }

    override fun onDestroy() {
        streamsJob?.cancel()
        stopPreview()
        super.onDestroy()
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
