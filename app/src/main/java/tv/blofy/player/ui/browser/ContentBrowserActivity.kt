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
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catchup.CatchupActivity
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

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
    private var resumedOnce = false
    private val epgRefreshAt = mutableMapOf<String, Long>()
    private val kind by lazy { intent.getStringExtra(EXTRA_KIND) ?: KIND_LIVE }
    private val deviceKind by lazy { DeviceClass.detect(this) }
    private val phoneMode get() = deviceKind == DeviceClass.Kind.PHONE
    private val previewEnabled get() = kind == KIND_LIVE && !phoneMode
    private val statePrefs by lazy { getSharedPreferences("blofy_browser_state", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(if (phoneMode) 18 else 30, if (phoneMode) 16 else 22, if (phoneMode) 18 else 30, if (phoneMode) 16 else 22)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = when (kind) { KIND_MOVIE -> "الأفلام"; KIND_SERIES -> "المسلسلات"; else -> "البث المباشر" }
            textSize = if (phoneMode) 24f else 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(8, 0, 0, if (phoneMode) 10 else 18)
        })

        val body = LinearLayout(this).apply { orientation = if (phoneMode) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL }
        val categories = RecyclerView(this).apply {
            layoutManager = if (phoneMode) LinearLayoutManager(this@ContentBrowserActivity, RecyclerView.HORIZONTAL, false)
            else LinearLayoutManager(this@ContentBrowserActivity)
        }
        val streams = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@ContentBrowserActivity) }

        if (phoneMode) {
            body.addView(categories, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 92).apply { bottomMargin = 10 })
            body.addView(streams, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            body.addView(categories, LinearLayout.LayoutParams(280, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 18 })
            if (previewEnabled) {
                body.addView(streams, LinearLayout.LayoutParams(360, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 22 })
                body.addView(createPreviewPanel(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            } else {
                body.addView(streams, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            }
        }
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        streamAdapter = FocusTextAdapter(
            label = { (if (it.locked) "🔒 " else "") + it.name + if (kind == KIND_LIVE && it.archiveEnabled) "  ⏱" else "" },
            onClick = ::openStream,
            onFocus = {
                if (previewEnabled && !it.locked) {
                    rememberStream(it)
                    schedulePreview(it)
                }
            },
            onLongClick = { if (kind == KIND_LIVE && it.archiveEnabled) openCatchup(it) },
            itemKey = { it.key }
        )
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(it.remoteId) },
            onFocus = { if (!phoneMode) loadStreams(it.remoteId) },
            itemKey = { it.key }
        )
        categories.adapter = categoryAdapter
        streams.adapter = streamAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { items ->
                categoryAdapter.submit(items)
                if (items.isEmpty()) {
                    loadStreams(null)
                } else {
                    val saved = savedCategoryId()
                    val initial = items.firstOrNull { it.remoteId == saved }?.remoteId ?: items.first().remoteId
                    if (currentCategoryId != initial) loadStreams(initial)
                }
            }
        }
    }

    private fun createPreviewPanel() = LinearLayout(this).apply {
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
            text = "OK: ملء الشاشة   •   ضغط مطوّل: الأرشيف ⏱   •   ↑↓: القنوات"
            textSize = 14f
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(4, 14, 0, 0)
        })
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        if (currentCategoryId == categoryId && streamsJob?.isActive == true) return
        currentCategoryId = categoryId
        rememberCategory(categoryId)
        lastPreviewKey = null
        stopPreview()
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->
                streamAdapter.submit(items)
                if (previewEnabled && items.isNotEmpty() && previewSession == null) {
                    val target = items.firstOrNull { it.key == savedStreamKey() && !it.locked } ?: items.firstOrNull { !it.locked }
                    if (target != null) schedulePreview(target, immediate = true)
                }
            }
        }
    }

    private fun schedulePreview(stream: StreamEntity, immediate: Boolean = false) {
        if (!previewEnabled || !::provider.isInitialized || stream.locked || stream.key == lastPreviewKey) return
        previewJob?.cancel()
        previewJob = lifecycleScope.launch {
            if (!immediate) delay(220)
            startPreview(stream)
        }
    }

    private fun startPreview(stream: StreamEntity) {
        if (!previewEnabled) return
        val profile = profile(provider)
        val url = ContentUrlResolver.live(provider, profile, stream)
        if (previewSession == null) {
            previewSession = BlofyPlaybackSession(this, profile, "live_preview")
            previewView?.player = previewSession?.player
        }
        lastPreviewKey = stream.key
        rememberStream(stream)
        previewTitle?.text = stream.name
        previewSession?.play(url)
        refreshShortEpg(stream)
    }

    private fun refreshShortEpg(stream: StreamEntity) {
        if (!::provider.isInitialized || provider.providerType.equals("m3u", true)) return
        val now = System.currentTimeMillis()
        val last = epgRefreshAt[stream.remoteId] ?: 0L
        if (now - last < 120_000L) return
        epgRefreshAt[stream.remoteId] = now
        lifecycleScope.launch {
            runCatching {
                PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncShortEpg(provider, stream.remoteId)
            }
        }
    }

    private fun stopPreview() {
        previewJob?.cancel()
        previewView?.player = null
        previewSession?.release()
        previewSession = null
    }

    private fun openStream(stream: StreamEntity) {
        if (stream.locked) ParentalGate.requirePin(this) { openUnlockedStream(stream) } else openUnlockedStream(stream)
    }

    private fun openCatchup(stream: StreamEntity) {
        if (stream.locked) ParentalGate.requirePin(this) { launchCatchup(stream) } else launchCatchup(stream)
    }

    private fun launchCatchup(stream: StreamEntity) {
        if (!stream.archiveEnabled || provider.providerType.equals("m3u", true)) return
        stopPreview()
        startActivity(Intent(this, CatchupActivity::class.java).apply {
            putExtra(CatchupActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatchupActivity.EXTRA_CONTENT_KEY, stream.key)
        })
    }

    private fun openUnlockedStream(stream: StreamEntity) {
        when (kind) {
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, provider.id)
                putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            else -> {
                rememberStream(stream)
                refreshShortEpg(stream)
                val url = ContentUrlResolver.live(provider, profile(provider), stream)
                stopPreview()
                launchPlayer(stream, url)
            }
        }
    }

    private fun launchPlayer(stream: StreamEntity, url: String) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, kind)
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_RESUME_MS, 0L)
            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, currentCategoryId)
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
        })
    }

    override fun onResume() {
        super.onResume()
        if (resumedOnce && previewEnabled && ::provider.isInitialized) {
            lastPreviewKey = null
            restartSavedPreview()
        }
        resumedOnce = true
    }

    private fun restartSavedPreview() {
        if (!previewEnabled) return
        lifecycleScope.launch {
            val items = BlofyDatabase.get(applicationContext).dao().streams(provider.id, KIND_LIVE, currentCategoryId).first()
            val target = items.firstOrNull { it.key == savedStreamKey() && !it.locked } ?: items.firstOrNull { !it.locked }
            if (target != null) schedulePreview(target, true)
        }
    }

    private fun rememberCategory(categoryId: String?) {
        if (::provider.isInitialized && kind == KIND_LIVE) statePrefs.edit().putString(categoryKey(), categoryId).apply()
    }

    private fun rememberStream(stream: StreamEntity) {
        if (::provider.isInitialized && kind == KIND_LIVE) statePrefs.edit().putString(streamKey(), stream.key).apply()
    }

    private fun savedCategoryId(): String? = if (::provider.isInitialized && kind == KIND_LIVE) statePrefs.getString(categoryKey(), null) else null
    private fun savedStreamKey(): String? = if (::provider.isInitialized && kind == KIND_LIVE) statePrefs.getString(streamKey(), null) else null
    private fun categoryKey() = "${provider.id}:live:last_category"
    private fun streamKey() = "${provider.id}:live:last_stream"

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
