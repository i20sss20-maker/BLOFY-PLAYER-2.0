package tv.blofy.player.ui.browser

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
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.BlofyPlaybackSession
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
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
    private lateinit var categoryList: RecyclerView
    private lateinit var streamList: RecyclerView
    private lateinit var searchInput: EditText
    private var streamsJob: Job? = null
    private var searchJob: Job? = null
    private var previewJob: Job? = null
    private var previewSession: BlofyPlaybackSession? = null
    private var previewView: PlayerView? = null
    private var previewTitle: TextView? = null
    private var previewMeta: TextView? = null
    private var currentCategoryId: String? = null
    private var currentRows: List<StreamEntity> = emptyList()
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
            setPadding(if (phoneMode) dp(16) else dp(22), if (phoneMode) dp(14) else dp(18), if (phoneMode) dp(16) else dp(22), if (phoneMode) dp(14) else dp(18))
            background = AppCompatResources.getDrawable(this@ContentBrowserActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        root.addView(buildHeader(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, if (phoneMode) dp(64) else dp(72)))

        val body = LinearLayout(this).apply {
            orientation = if (phoneMode) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            clipChildren = false
            clipToPadding = false
        }
        categoryList = RecyclerView(this).apply {
            layoutManager = if (phoneMode) LinearLayoutManager(this@ContentBrowserActivity, RecyclerView.HORIZONTAL, false)
            else LinearLayoutManager(this@ContentBrowserActivity)
            background = browserPanelBackground(true)
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        streamList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@ContentBrowserActivity)
            background = browserPanelBackground(false)
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(7), dp(7), dp(7), dp(7))
        }

        if (phoneMode) {
            body.addView(categoryList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88)).apply { bottomMargin = dp(8) })
            body.addView(streamList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            // TV: compact categories, readable channel names, large preview.
            body.addView(categoryList, LinearLayout.LayoutParams(dp(245), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(12) })
            body.addView(streamList, LinearLayout.LayoutParams(dp(430), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(16) })
            if (previewEnabled) body.addView(createPreviewPanel(), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        }
        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        streamAdapter = FocusTextAdapter(
            label = { it.name + if (kind == KIND_LIVE && it.archiveEnabled) "   ⏱" else "" },
            onClick = ::openStream,
            onFocus = { stream ->
                rememberStream(stream)
                if (previewEnabled && searchInput.text.isNullOrBlank()) schedulePreview(stream)
            },
            onLongClick = { if (kind == KIND_LIVE && it.archiveEnabled) openCatchup(it) },
            itemKey = { it.key }
        )
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryId(it)) },
            onFocus = { if (!phoneMode && searchInput.text.isNullOrBlank()) loadStreams(categoryId(it)) },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        streamList.adapter = streamAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { rows ->
                val displayed = if (kind == KIND_LIVE) listOf(allLiveCategory()) + rows else listOf(allCategory()) + rows
                categoryAdapter.submit(displayed)
                val saved = savedCategoryId()
                val initial = rows.firstOrNull { it.remoteId == saved }?.remoteId
                    ?: if (kind == KIND_LIVE) rows.firstOrNull()?.remoteId else null
                if (streamsJob == null) loadStreams(initial)
                categoryList.post { categoryList.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            }
        }
    }

    private fun buildHeader() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        addView(TextView(this@ContentBrowserActivity).apply {
            text = when (kind) {
                KIND_MOVIE -> "الأفلام"
                KIND_SERIES -> "المسلسلات"
                else -> "البث المباشر"
            }
            textSize = if (phoneMode) 25f else 30f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        searchInput = EditText(this@ContentBrowserActivity).apply {
            hint = "⌕  بحث من أول حرف"
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            textSize = 15f
            setTextColor(Color.WHITE)
            setHintTextColor(0xFFAE9ABD.toInt())
            setPadding(dp(16), 0, dp(16), 0)
            background = searchBackground(false)
            setOnFocusChangeListener { view, focused -> view.background = searchBackground(focused) }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = runSearch(s?.toString().orEmpty())
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }
        addView(searchInput, LinearLayout.LayoutParams(if (phoneMode) dp(270) else dp(345), if (phoneMode) dp(48) else dp(52)))
    }

    private fun createPreviewPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = previewPanelBackground()
        previewTitle = TextView(this@ContentBrowserActivity).apply {
            text = "اختر قناة"
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        }
        addView(previewTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)))
        previewMeta = TextView(this@ContentBrowserActivity).apply {
            text = "المعاينة تبدأ تلقائيًا"
            textSize = 13f
            setTextColor(BLOFY_PURPLE_SOFT)
            gravity = Gravity.RIGHT
        }
        addView(previewMeta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)))
        previewView = PlayerView(this@ContentBrowserActivity).apply {
            useController = false
            player = null
            isFocusable = false
            setShutterBackgroundColor(Color.BLACK)
            resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        addView(previewView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(TextView(this@ContentBrowserActivity).apply {
            text = "OK ملء الشاشة   •   ↑↓ القنوات   •   ضغط مطوّل للأرشيف"
            textSize = 13f
            setTextColor(0xFFB9A8CA.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)))
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
                currentRows = items
                if (searchInput.text.isNullOrBlank()) {
                    streamAdapter.submit(items)
                    if (previewEnabled && items.isNotEmpty() && previewSession == null) {
                        val target = items.firstOrNull { it.key == savedStreamKey() } ?: items.first()
                        schedulePreview(target, true)
                    }
                }
            }
        }
    }

    private fun runSearch(raw: String) {
        searchJob?.cancel()
        val query = raw.trim()
        if (query.isEmpty()) {
            streamAdapter.submit(currentRows)
            if (previewEnabled && currentRows.isNotEmpty()) schedulePreview(currentRows.first(), true)
            return
        }
        stopPreview()
        if (!::provider.isInitialized) return
        searchJob = lifecycleScope.launch {
            delay(45L)
            val all = withContext(Dispatchers.IO) {
                BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, null).first()
            }
            val matches = withContext(Dispatchers.Default) {
                all.asSequence().filter { it.name.contains(query, ignoreCase = true) }.take(700).toList()
            }
            if (searchInput.text?.toString()?.trim() == query) streamAdapter.submit(matches)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_SEARCH) {
            searchInput.requestFocus(); return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun schedulePreview(stream: StreamEntity, immediate: Boolean = false) {
        if (!previewEnabled || !::provider.isInitialized || stream.key == lastPreviewKey) return
        previewJob?.cancel()
        previewJob = lifecycleScope.launch {
            if (!immediate) delay(160L)
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
        previewMeta?.text = if (stream.archiveEnabled) "بث مباشر • أرشيف متوفر" else "بث مباشر"
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
            runCatching { PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncShortEpg(provider, stream.remoteId) }
        }
    }

    private fun stopPreview() {
        previewJob?.cancel()
        previewView?.player = null
        previewSession?.release()
        previewSession = null
    }

    private fun openStream(stream: StreamEntity) {
        when (stream.kind) {
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

    private fun openCatchup(stream: StreamEntity) {
        if (!::provider.isInitialized || !stream.archiveEnabled || provider.providerType.equals("m3u", true)) return
        stopPreview()
        startActivity(Intent(this, CatchupActivity::class.java).apply {
            putExtra(CatchupActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatchupActivity.EXTRA_CONTENT_KEY, stream.key)
        })
    }

    private fun launchPlayer(stream: StreamEntity, url: String) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, stream.kind)
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, 0L)
            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, currentCategoryId)
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
        })
    }

    override fun onResume() {
        super.onResume()
        if (resumedOnce && previewEnabled && ::provider.isInitialized && searchInput.text.isNullOrBlank()) {
            lastPreviewKey = null
            restartSavedPreview()
        }
        resumedOnce = true
    }

    private fun restartSavedPreview() {
        lifecycleScope.launch {
            val items = BlofyDatabase.get(applicationContext).dao().streams(provider.id, KIND_LIVE, currentCategoryId).first()
            val target = items.firstOrNull { it.key == savedStreamKey() } ?: items.firstOrNull()
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
    private fun categoryId(category: CategoryEntity): String? = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun allLiveCategory() = CategoryEntity("${provider.id}:live:$ALL_CATEGORY_ID", provider.id, ALL_CATEGORY_ID, KIND_LIVE, "كل القنوات", -1)
    private fun allCategory() = CategoryEntity("${provider.id}:$kind:$ALL_CATEGORY_ID", provider.id, ALL_CATEGORY_ID, kind, if (kind == KIND_MOVIE) "كل الأفلام" else "كل المسلسلات", -1)

    override fun onDestroy() {
        streamsJob?.cancel(); searchJob?.cancel(); stopPreview(); super.onDestroy()
    }

    private fun profile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (provider.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (provider.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects,
        providerKind = tv.blofy.player.core.provider.ProviderKind.from(provider.providerType)
    )

    private fun browserPanelBackground(emphasis: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (emphasis) intArrayOf(0xE8231633.toInt(), 0xF0110C1A.toInt()) else intArrayOf(0xE6191224.toInt(), 0xF00B0912.toInt())
    ).apply { cornerRadius = dp(18).toFloat(); setStroke(dp(1), if (emphasis) 0x665E3A87 else 0x454A355F) }

    private fun previewPanelBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xEF1E1230.toInt(), 0xF5080710.toInt())
    ).apply { cornerRadius = dp(20).toFloat(); setStroke(dp(1), 0x706E3CAE) }

    private fun searchBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF8436D5.toInt(), 0xFF5620A5.toInt()) else intArrayOf(0xDD21132C.toInt(), 0xE5130B1C.toInt())
    ).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x66573B70) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val ALL_CATEGORY_ID = "__all__"
        private val BLOFY_PURPLE_SOFT = Color.rgb(195, 135, 255)
    }
}
