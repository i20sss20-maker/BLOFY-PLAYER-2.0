package tv.blofy.player.ui.browser

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
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
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catchup.CatchupActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.common.TwoPaneFocusGuard
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.settings.RuntimeSettings

@OptIn(markerClass = [UnstableApi::class])
class ContentBrowserActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var streamAdapter: LiveChannelAdapter
    private var streamsJob: Job? = null
    private var livePageJob: Job? = null
    private var categoryFocusJob: Job? = null
    private var catalogRefreshJob: Job? = null
    private var previewJob: Job? = null
    private var previewSession: BlofyPlaybackSession? = null
    private var previewView: PlayerView? = null
    private var previewTitle: TextView? = null
    private var currentCategoryId: String? = null
    private var catalogRepairAttempted = false
    private lateinit var categoryList: RecyclerView
    private lateinit var streamList: RecyclerView
    private var catalogStatus: TextView? = null
    private var catalogRetry: Button? = null
    private var lastPreviewKey: String? = null
    private var resumedOnce = false
    private val epgRefreshAt = mutableMapOf<String, Long>()

    private val liveItems = ArrayList<StreamEntity>(256)
    private var liveTotal = 0
    private var liveLastRowId = 0L
    private var liveLoading = false
    private var liveGeneration = 0

    private val kind by lazy { intent.getStringExtra(EXTRA_KIND) ?: KIND_LIVE }
    private val deviceKind by lazy { DeviceClass.detect(this) }
    private val phoneMode get() = deviceKind == DeviceClass.Kind.PHONE
    private val previewEnabled get() = kind == KIND_LIVE && !phoneMode && RuntimeSettings.autoplayLive(this)
    private val statePrefs by lazy { getSharedPreferences("blofy_browser_state", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            setPadding(if (phoneMode) 18 else 30, if (phoneMode) 16 else 22, if (phoneMode) 18 else 30, if (phoneMode) 16 else 22)
            background = AppCompatResources.getDrawable(this@ContentBrowserActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        root.addView(TextView(this).apply {
            val section = when (kind) { KIND_MOVIE -> "الأفلام"; KIND_SERIES -> "المسلسلات"; else -> "البث المباشر" }
            text = "BLOFY  •  $section"
            textSize = if (phoneMode) 24f else 29f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            includeFontPadding = false
            setPadding(8, 0, 0, if (phoneMode) 10 else 14)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, if (phoneMode) 58 else 64))

        val body = LinearLayout(this).apply {
            orientation = if (phoneMode) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }
        categoryList = RecyclerView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            layoutManager = if (phoneMode) LinearLayoutManager(this@ContentBrowserActivity, RecyclerView.HORIZONTAL, false)
            else LinearLayoutManager(this@ContentBrowserActivity)
            background = BlofyTvDesign.elevatedSurface(24f)
            elevation = 4f
            setPadding(8, 10, 8, 10)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setItemViewCacheSize(if (phoneMode) 10 else 16)
        }
        streamList = RecyclerView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            layoutManager = LinearLayoutManager(this@ContentBrowserActivity)
            background = BlofyTvDesign.elevatedSurface(24f)
            elevation = 4f
            setPadding(8, 10, 8, 10)
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setItemViewCacheSize(if (phoneMode) 12 else 22)
            recycledViewPool.setMaxRecycledViews(0, 28)
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                    if (kind != KIND_LIVE || dy <= 0 || liveLoading || liveItems.size >= liveTotal) return
                    val lm = recyclerView.layoutManager as? LinearLayoutManager ?: return
                    if (lm.findLastVisibleItemPosition() >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()
                }
            })
        }

        if (kind != KIND_LIVE) root.addView(createCatalogStatusRow())

        if (phoneMode) {
            body.addView(categoryList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 92).apply { bottomMargin = 10 })
            body.addView(streamList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            body.addView(categoryList, LinearLayout.LayoutParams(250, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 20 })
            if (previewEnabled) {
                body.addView(streamList, LinearLayout.LayoutParams(420, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 22 })
                body.addView(createPreviewPanel(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            } else {
                body.addView(streamList, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            }
        }
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        streamAdapter = LiveChannelAdapter(
            onClick = ::openStream,
            onFocus = { stream ->
                if (kind == KIND_LIVE) {
                    rememberStream(stream)
                    val index = streamAdapter.indexOfKey(stream.key)
                    if (index >= liveItems.size - LIVE_PREFETCH_THRESHOLD) loadNextLivePage()
                }
                if (previewEnabled && !stream.locked) schedulePreview(stream)
            },
            onLongClick = { if (kind == KIND_LIVE && it.archiveEnabled) openCatchup(it) },
            itemKey = { it.key }
        )
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = {
                categoryFocusJob?.cancel()
                loadStreams(categoryId(it))
            },
            onFocus = { if (!phoneMode) scheduleCategoryLoad(categoryId(it)) },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        streamList.adapter = streamAdapter

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            provider = dao.providers().first().firstOrNull() ?: run { finish(); return@launch }
            dao.categories(provider.id, kind).collect { items ->
                val displayed = if (kind == KIND_LIVE) items else listOf(allCategory()) + items
                categoryAdapter.submit(displayed)
                if (kind != KIND_LIVE) {
                    loadStreams(null)
                    requestInitialCatalogFocus()
                } else if (items.isEmpty()) {
                    loadStreams(null)
                } else {
                    val saved = savedCategoryId()
                    val initial = items.firstOrNull { it.remoteId == saved }?.remoteId ?: items.first().remoteId
                    if (currentCategoryId != initial || liveItems.isEmpty()) loadStreams(initial)
                }
            }
        }
    }

    private fun scheduleCategoryLoad(categoryId: String?) {
        if (!::provider.isInitialized || currentCategoryId == categoryId) return
        categoryFocusJob?.cancel()
        categoryFocusJob = lifecycleScope.launch {
            delay(if (kind == KIND_LIVE) 90L else 70L)
            loadStreams(categoryId)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!phoneMode && ::categoryList.isInitialized && ::streamList.isInitialized &&
            TwoPaneFocusGuard.handle(event, categoryList, streamList,
                ::focusCurrentCategory, ::focusFirstChannel)) return true
        return super.dispatchKeyEvent(event)
    }

    private fun focusFirstChannel(): Boolean {
        if (streamAdapter.itemCount == 0) return false
        val savedIndex = streamAdapter.indexOfKey(savedStreamKey()).takeIf { it >= 0 } ?: 0
        return TwoPaneFocusGuard.focusItem(streamList, savedIndex)
    }

    private fun focusCurrentCategory(): Boolean {
        val lm = categoryList.layoutManager as? LinearLayoutManager ?: return false
        val position = categoryAdapter.focusedIndex().takeIf { it in 0 until categoryAdapter.itemCount }
            ?: lm.findFirstVisibleItemPosition().coerceAtLeast(0)
        return TwoPaneFocusGuard.focusItem(categoryList, position)
    }

    private fun createCatalogStatusRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(12, 0, 12, if (phoneMode) 8 else 12)
        background = BlofyTvDesign.elevatedSurface(20f)
        catalogStatus = TextView(this@ContentBrowserActivity).apply {
            text = "جاري التحقق من ${catalogLabel()}..."
            textSize = if (phoneMode) 14f else 15f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
        }
        addView(catalogStatus, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        catalogRetry = Button(this@ContentBrowserActivity).apply {
            text = "إعادة المحاولة"
            isAllCaps = false
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            visibility = View.GONE
            BlofyTvDesign.installTvFocus(this, 16f, 1.025f, false)
            setOnClickListener { refreshMissingCatalog() }
        }
        addView(catalogRetry, LinearLayout.LayoutParams(if (phoneMode) 170 else 210, if (phoneMode) 58 else 64))
    }

    private fun createPreviewPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(18, 18, 18, 18)
        background = BlofyTvDesign.elevatedSurface(26f)
        elevation = 5f
        previewTitle = TextView(this@ContentBrowserActivity).apply {
            text = "اختر قناة"
            textSize = 22f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            includeFontPadding = false
            setPadding(4, 0, 4, 10)
        }
        addView(previewTitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 48))
        addView(TextView(this@ContentBrowserActivity).apply {
            text = "● مباشر  •  المعاينة تبدأ تلقائيًا"
            textSize = 13f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.RIGHT
            setPadding(4, 0, 4, 10)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 34))
        previewView = PlayerView(this@ContentBrowserActivity).apply {
            useController = false
            player = null
            isFocusable = false
            setShutterBackgroundColor(Color.BLACK)
            resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        }
        addView(previewView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(TextView(this@ContentBrowserActivity).apply {
            text = "OK ملء الشاشة   •   ↑↓ القنوات   •   ← رجوع للفئات   •   ضغط مطوّل للأرشيف"
            textSize = 12.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(4, 12, 4, 0)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 40))
    }

    private fun loadStreams(categoryId: String?) {
        if (!::provider.isInitialized) return
        if (kind == KIND_LIVE) {
            loadLiveStreams(categoryId)
            return
        }
        if (currentCategoryId == categoryId && streamsJob?.isActive == true) return
        currentCategoryId = categoryId
        streamsJob?.cancel()
        streamsJob = lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().streams(provider.id, kind, categoryId).collect { items ->
                streamAdapter.submit(items)
                updateCatalogState(items, categoryId)
            }
        }
    }

    private fun loadLiveStreams(categoryId: String?) {
        if (currentCategoryId == categoryId && liveItems.isNotEmpty()) return
        currentCategoryId = categoryId
        rememberCategory(categoryId)
        lastPreviewKey = null
        previewJob?.cancel()
        liveGeneration += 1
        livePageJob?.cancel()
        liveItems.clear()
        liveTotal = 0
        liveLastRowId = 0L
        liveLoading = false
        streamAdapter.replace(emptyList())
        loadNextLivePage(reset = true)
    }

    private fun loadNextLivePage(reset: Boolean = false) {
        if (!::provider.isInitialized || kind != KIND_LIVE || liveLoading) return
        if (!reset && liveTotal > 0 && liveItems.size >= liveTotal) return
        val generation = liveGeneration
        val cursor = if (reset) 0L else liveLastRowId
        val categoryId = currentCategoryId
        liveLoading = true
        livePageJob = lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val result = withContext(Dispatchers.IO) {
                val total = if (categoryId == null) dao.catalogCountAll(provider.id, KIND_LIVE)
                else dao.catalogCountInCategory(provider.id, KIND_LIVE, categoryId)
                val page = if (categoryId == null) dao.catalogPageAfterAll(provider.id, KIND_LIVE, cursor, LIVE_PAGE_SIZE)
                else dao.catalogPageAfterInCategory(provider.id, KIND_LIVE, categoryId, cursor, LIVE_PAGE_SIZE)
                val rowId = page.lastOrNull()?.let { dao.streamRowId(it.key) } ?: cursor
                Triple(total, page, rowId)
            }
            if (generation != liveGeneration) return@launch
            liveTotal = result.first
            liveLastRowId = result.third
            if (reset) {
                liveItems.clear()
                liveItems.addAll(result.second)
                streamAdapter.replace(result.second)
            } else {
                liveItems.addAll(result.second)
                streamAdapter.append(result.second)
            }
            liveLoading = false
            if (result.second.isNotEmpty()) {
                ArtworkLoader.prefetch(this@ContentBrowserActivity, result.second.take(20).map { it.icon })
            }
            if (reset && previewEnabled) startInitialPreview(result.second)
        }.also { job ->
            job.invokeOnCompletion { if (generation == liveGeneration) runOnUiThread { liveLoading = false } }
        }
    }

    private fun startInitialPreview(page: List<StreamEntity>) {
        if (page.isEmpty()) return
        lifecycleScope.launch {
            val saved = savedStreamKey()?.let { BlofyDatabase.get(applicationContext).dao().stream(it) }
                ?.takeIf { it.providerId == provider.id && it.kind == KIND_LIVE && it.categoryId == currentCategoryId && !it.locked }
            val target = saved ?: page.firstOrNull { !it.locked }
            if (target != null) schedulePreview(target, immediate = previewSession == null)
        }
    }

    private fun updateCatalogState(items: List<StreamEntity>, categoryId: String?) {
        if (items.isNotEmpty()) {
            hideCatalogStatus()
            if (categoryId == null) requestInitialCatalogFocus()
            return
        }
        if (categoryId != null) {
            showCatalogStatus("لا يوجد محتوى في هذا القسم • اختر ${allCategory().name}", retry = false)
            return
        }
        showCatalogStatus("لا توجد ${catalogLabel()} محفوظة • حدّث المكتبة يدويًا", retry = true)
    }

    private fun refreshMissingCatalog() {
        if (!::provider.isInitialized || kind == KIND_LIVE) return
        catalogRepairAttempted = true
        startActivity(Intent(this, CatalogLoadingActivity::class.java).apply {
            putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH, true)
        })
    }

    private fun showCatalogStatus(message: String, retry: Boolean) {
        catalogStatus?.apply { text = message; visibility = View.VISIBLE }
        catalogRetry?.visibility = if (retry) View.VISIBLE else View.GONE
    }

    private fun hideCatalogStatus() {
        catalogStatus?.visibility = View.GONE
        catalogRetry?.visibility = View.GONE
    }

    private fun requestInitialCatalogFocus() {
        if (phoneMode || kind == KIND_LIVE || categoryList.hasFocus() || streamList.hasFocus()) return
        categoryList.post {
            categoryList.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus()
                ?: categoryList.post { categoryList.findViewHolderForAdapterPosition(0)?.itemView?.requestFocus() }
        }
    }

    private fun categoryId(category: CategoryEntity): String? = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }

    private fun allCategory() = CategoryEntity(
        key = "${if (::provider.isInitialized) provider.id else "catalog"}:$kind:$ALL_CATEGORY_ID",
        providerId = if (::provider.isInitialized) provider.id else "catalog",
        remoteId = ALL_CATEGORY_ID,
        kind = kind,
        name = if (kind == KIND_MOVIE) "كل الأفلام" else "كل المسلسلات",
        orderIndex = -1
    )

    private fun catalogLabel(): String = if (kind == KIND_MOVIE) "أفلام" else "مسلسلات"

    private fun schedulePreview(stream: StreamEntity, immediate: Boolean = false) {
        if (!previewEnabled || !::provider.isInitialized || stream.locked || stream.key == lastPreviewKey) return
        previewJob?.cancel()
        previewJob = lifecycleScope.launch {
            if (!immediate) delay(180)
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
        lifecycleScope.launch { runCatching { PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncShortEpg(provider, stream.remoteId) } }
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
        if (resumedOnce && previewEnabled && ::provider.isInitialized) {
            lastPreviewKey = null
            restartSavedPreview()
        }
        resumedOnce = true
    }

    private fun restartSavedPreview() {
        if (!previewEnabled) return
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val saved = savedStreamKey()?.let { dao.stream(it) }
                ?.takeIf { it.providerId == provider.id && it.kind == KIND_LIVE && it.categoryId == currentCategoryId && !it.locked }
            val fallback = if (saved == null) {
                withContext(Dispatchers.IO) {
                    if (currentCategoryId == null) dao.catalogPageAfterAll(provider.id, KIND_LIVE, 0L, 1).firstOrNull()
                    else dao.catalogPageAfterInCategory(provider.id, KIND_LIVE, currentCategoryId.orEmpty(), 0L, 1).firstOrNull()
                }
            } else null
            val target = saved ?: fallback
            if (target != null && !target.locked) schedulePreview(target, true)
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
        livePageJob?.cancel()
        categoryFocusJob?.cancel()
        catalogRefreshJob?.cancel()
        liveGeneration += 1
        stopPreview()
        super.onDestroy()
    }

    private fun profile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (provider.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (provider.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects,
        providerKind = tv.blofy.player.core.provider.ProviderKind.from(provider.providerType)
    )

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_LIVE = "live"
        const val KIND_MOVIE = "movie"
        const val KIND_SERIES = "series"
        private const val ALL_CATEGORY_ID = "__all__"
        private const val LIVE_PAGE_SIZE = 220
        private const val LIVE_PREFETCH_THRESHOLD = 45
    }
}
