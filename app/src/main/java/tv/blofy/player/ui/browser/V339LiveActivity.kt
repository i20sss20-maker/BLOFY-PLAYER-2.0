package tv.blofy.player.ui.browser

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
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
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.settings.SettingsActivity

/** Exact v339 live-TV composition backed by the current 2.0 data/playback stack. */
@OptIn(markerClass = [UnstableApi::class])
class V339LiveActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryList: RecyclerView
    private lateinit var channelList: RecyclerView
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var channelAdapter: FocusTextAdapter<StreamEntity>
    private lateinit var search: EditText
    private lateinit var count: TextView
    private lateinit var channelName: TextView
    private lateinit var previewView: PlayerView
    private var streamsJob: Job? = null
    private var previewJob: Job? = null
    private var previewSession: BlofyPlaybackSession? = null
    private var currentCategoryId: String? = null
    private var currentRows: List<StreamEntity> = emptyList()
    private var lastPreviewKey: String? = null
    private val epgRefreshAt = mutableMapOf<String, Long>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = V339Ui.BLACK
        window.navigationBarColor = V339Ui.BLACK
        setContentView(buildScreen())
        bindAdapters()
        loadProviderAndCategories()
    }

    private fun buildScreen(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = V339Ui.screenGradient()
        }
        root.addView(buildTopBar(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76)))

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(6), dp(24), dp(20))
        }
        val tools = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        count = V339Ui.text(this, "0 قناة متاحة", 12f, V339Ui.MUTED).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }
        tools.addView(count, LinearLayout.LayoutParams(dp(220), dp(50)))
        search = V339Ui.input(this, "ابحث باسم أو رقم القناة", false)
        tools.addView(search, LinearLayout.LayoutParams(0, dp(48), 1f))
        page.addView(tools, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))

        val columns = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            // User-requested variation on v339: categories anchored on the right.
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        val categoryPanel = columnPanel("التصنيفات")
        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@V339LiveActivity)
            itemAnimator = null
            clipToPadding = false
            setPadding(dp(5), dp(3), dp(5), dp(8))
        }
        categoryPanel.addView(categoryList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        columns.addView(categoryPanel, LinearLayout.LayoutParams(dp(224), ViewGroup.LayoutParams.MATCH_PARENT))

        val channelsPanel = columnPanel("القنوات")
        channelList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@V339LiveActivity)
            itemAnimator = null
            clipToPadding = false
            setPadding(dp(4), dp(3), dp(4), dp(8))
        }
        channelsPanel.addView(channelList, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        columns.addView(channelsPanel, LinearLayout.LayoutParams(dp(338), ViewGroup.LayoutParams.MATCH_PARENT).apply {
            marginStart = dp(10); marginEnd = dp(10)
        })

        val previewPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(10))
            background = V339Ui.gradientPanel(this@V339LiveActivity, Color.rgb(12, 10, 23), Color.rgb(7, 7, 14), 16, V339Ui.STROKE)
        }
        val previewFrame = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        previewView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            setShutterBackgroundColor(Color.BLACK)
        }
        previewFrame.addView(previewView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        previewPanel.addView(previewFrame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        previewPanel.addView(V339Ui.text(this, "يعرض الآن", 10f, V339Ui.PURPLE_LIGHT).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)))
        channelName = V339Ui.title(this, "اختر قناة للمعاينة", 20f).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_LTR
            isSingleLine = true
        }
        previewPanel.addView(channelName, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)))
        previewPanel.addView(V339Ui.text(this, "↑↓ معاينة  •  OK تشغيل ملء الشاشة", 11f, V339Ui.MUTED).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)))
        columns.addView(previewPanel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))

        page.addView(columns, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(page, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    private fun buildTopBar(): View {
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(dp(26), dp(10), dp(24), dp(8))
            background = V339Ui.panel(this@V339LiveActivity, Color.argb(185, 7, 6, 15), 0, V339Ui.DIVIDER)
        }
        val home = V339Ui.navChip(this, "⌂  الرئيسية").apply {
            textSize = 12f
            setOnClickListener { startActivity(Intent(this@V339LiveActivity, HomeActivity::class.java)); finish() }
        }
        top.addView(home, LinearLayout.LayoutParams(dp(122), dp(42)))
        top.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))

        val heading = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        heading.addView(V339Ui.title(this, "البث المباشر", 23f).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL; textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(31)))
        heading.addView(V339Ui.text(this, "مرحباً بك في BLOFY", 10f, V339Ui.MUTED).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL; textDirection = View.TEXT_DIRECTION_RTL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(20)))
        top.addView(heading, LinearLayout.LayoutParams(0, dp(56), 1f))

        val status = V339Ui.chip(this, "●  BLOFY NATIVE").apply { setTextColor(V339Ui.SUCCESS) }
        top.addView(status, LinearLayout.LayoutParams(dp(132), dp(32)).apply { marginEnd = dp(10) })
        top.addView(V339Ui.navChip(this, "⚙").apply {
            setOnClickListener { startActivity(Intent(this@V339LiveActivity, SettingsActivity::class.java)) }
        }, LinearLayout.LayoutParams(dp(50), dp(42)).apply { marginStart = dp(4); marginEnd = dp(4) })
        return top
    }

    private fun columnPanel(titleValue: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = V339Ui.panel(this@V339LiveActivity, Color.argb(205, 14, 12, 25), 16, V339Ui.STROKE)
        addView(V339Ui.title(this@V339LiveActivity, titleValue, 13f).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
            setPadding(dp(14), 0, dp(14), 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(45)))
    }

    private fun bindAdapters() {
        channelAdapter = FocusTextAdapter(
            label = { (if (it.locked) "🔒 " else "") + it.name + if (it.archiveEnabled) "  ⏱" else "" },
            onClick = ::openStream,
            onFocus = { if (!it.locked) schedulePreview(it) },
            itemKey = { it.key }
        )
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadStreams(categoryId(it)) },
            onFocus = { loadStreams(categoryId(it)) },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        channelList.adapter = channelAdapter

        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                val query = s?.toString().orEmpty().trim()
                channelAdapter.submit(if (query.isBlank()) currentRows else currentRows.filter { it.name.contains(query, true) || it.remoteId.contains(query, true) })
            }
        })
    }

    private fun loadProviderAndCategories() {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, KIND_LIVE).collect { categories ->
                val rows = listOf(allCategory()) + categories
                categoryAdapter.submit(rows)
                if (currentCategoryId == null && streamsJob == null) loadStreams(null)
                categoryList.post { categoryList.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
            }
        }
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        if (currentCategoryId == categoryId && streamsJob?.isActive == true) return
        currentCategoryId = categoryId
        stopPreview()
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, KIND_LIVE, categoryId).collect { items ->
                currentRows = items
                count.text = "${items.size} قناة متاحة"
                val query = search.text?.toString().orEmpty().trim()
                val displayed = if (query.isBlank()) items else items.filter { it.name.contains(query, true) || it.remoteId.contains(query, true) }
                channelAdapter.submit(displayed)
                displayed.firstOrNull { !it.locked }?.let { schedulePreview(it, immediate = true) }
            }
        }
    }

    private fun schedulePreview(stream: StreamEntity, immediate: Boolean = false) {
        if (!::provider.isInitialized || stream.locked || stream.key == lastPreviewKey) return
        previewJob?.cancel()
        previewJob = lifecycleScope.launch {
            if (!immediate) delay(220)
            startPreview(stream)
        }
    }

    private fun startPreview(stream: StreamEntity) {
        val url = ContentUrlResolver.live(provider, profile(provider), stream)
        if (previewSession == null) {
            previewSession = BlofyPlaybackSession(this, profile(provider), "live_preview")
            previewView.player = previewSession?.player
        }
        lastPreviewKey = stream.key
        channelName.text = stream.name
        previewSession?.play(url)
        refreshShortEpg(stream)
    }

    private fun refreshShortEpg(stream: StreamEntity) {
        if (provider.providerType.equals("m3u", true)) return
        val now = System.currentTimeMillis()
        val last = epgRefreshAt[stream.remoteId] ?: 0L
        if (now - last < 120_000L) return
        epgRefreshAt[stream.remoteId] = now
        lifecycleScope.launch {
            runCatching { PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncShortEpg(provider, stream.remoteId) }
        }
    }

    private fun openStream(stream: StreamEntity) {
        if (stream.locked) ParentalGate.requirePin(this) { openUnlocked(stream) } else openUnlocked(stream)
    }

    private fun openUnlocked(stream: StreamEntity) {
        val url = ContentUrlResolver.live(provider, profile(provider), stream)
        stopPreview()
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE)
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

    private fun stopPreview() {
        previewJob?.cancel()
        previewView.player = null
        previewSession?.release()
        previewSession = null
        lastPreviewKey = null
    }

    private fun allCategory() = CategoryEntity(
        key = "${provider.id}:live:$ALL_CATEGORY_ID",
        providerId = provider.id,
        remoteId = ALL_CATEGORY_ID,
        kind = KIND_LIVE,
        name = "الكل",
        orderIndex = -1
    )

    private fun categoryId(category: CategoryEntity): String? = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }

    private fun profile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (provider.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (provider.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects,
        providerKind = tv.blofy.player.core.provider.ProviderKind.from(provider.providerType)
    )

    override fun onResume() {
        super.onResume()
        if (::provider.isInitialized && currentRows.isNotEmpty() && previewSession == null) {
            currentRows.firstOrNull { !it.locked }?.let { schedulePreview(it, true) }
        }
    }

    override fun onDestroy() {
        streamsJob?.cancel()
        stopPreview()
        super.onDestroy()
    }

    private fun dp(value: Int) = V339Ui.dp(this, value)

    companion object {
        private const val KIND_LIVE = "live"
        private const val ALL_CATEGORY_ID = "__all__"
    }
}
