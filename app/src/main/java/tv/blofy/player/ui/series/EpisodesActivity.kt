package tv.blofy.player.ui.series

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.player.PlayerActivity

class EpisodesActivity : AppCompatActivity() {
    private lateinit var episodeAdapter: FocusTextAdapter<EpisodeEntity>
    private lateinit var seasonAdapter: FocusTextAdapter<Int>
    private lateinit var seasonList: RecyclerView
    private lateinit var episodeList: RecyclerView
    private lateinit var status: TextView
    private lateinit var seasonSummary: TextView
    private lateinit var retryButton: Button
    private var allEpisodes: List<EpisodeEntity> = emptyList()
    private var selectedSeason: Int? = null
    private var providerId = ""
    private var seriesId = ""
    private var restoredOnce = false
    private var syncInProgress = false
    private var loadState = EpisodeLoadState.LOADING
    private val watchProgress = mutableMapOf<String, Int>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        seriesId = intent.getStringExtra(EXTRA_SERIES_ID).orEmpty()
        val seriesName = intent.getStringExtra(EXTRA_SERIES_NAME).orEmpty()
        if (providerId.isBlank() || seriesId.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(30), dp(22), dp(30), dp(26))
            background = AppCompatResources.getDrawable(this@EpisodesActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(8), 0, dp(8), dp(10))
        }
        header.addView(TextView(this).apply {
            text = seriesName.ifBlank { "الحلقات" }
            BlofyTvDesign.applyTitle(this)
            textSize = 29f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            maxLines = 1
        }, LinearLayout.LayoutParams(0, dp(58), 1f))
        status = TextView(this).apply {
            text = "جاري تجهيز الحلقات..."
            BlofyTvDesign.applyCaption(this)
            textSize = 13.5f
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
        }
        header.addView(status, LinearLayout.LayoutParams(dp(430), dp(58)))
        root.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(68)))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        val infoFrame = FrameLayout(this).apply {
            background = panelBackground()
            elevation = dp(5).toFloat()
            clipChildren = true
        }
        val watermark = TextView(this).apply {
            text = "BLOFY"
            textSize = 54f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(0x18FFFFFF)
            gravity = Gravity.CENTER
            rotation = -8f
            isFocusable = false
        }
        infoFrame.addView(watermark, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(180), Gravity.CENTER))

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        info.addView(TextView(this).apply {
            text = "الموسم"
            BlofyTvDesign.applyCaption(this)
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.RIGHT
        })
        seasonSummary = TextView(this).apply {
            text = "جاري التجهيز…"
            BlofyTvDesign.applyHeading(this)
            textSize = 22f
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, dp(14))
        }
        info.addView(seasonSummary)
        info.addView(TextView(this).apply {
            text = "المواسم"
            BlofyTvDesign.applyCaption(this)
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(8))
        })
        seasonList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            itemAnimator = null
            setHasFixedSize(true)
            clipChildren = false
            clipToPadding = false
            setPadding(0, dp(2), 0, dp(2))
        }
        info.addView(seasonList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        retryButton = actionButton("↻  تحديث الحلقات") { lifecycleScope.launch { syncEpisodes(currentProvider()) } }.apply { visibility = View.GONE }
        info.addView(retryButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(10) })
        infoFrame.addView(info, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        body.addView(infoFrame, LinearLayout.LayoutParams(dp(330), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(16) })

        val episodesPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(14), dp(18), dp(14))
            background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            elevation = dp(5).toFloat()
        }
        val episodesTitle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        episodesTitle.addView(TextView(this).apply {
            text = "الحلقات"
            BlofyTvDesign.applyHeading(this)
            textSize = 20f
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        episodesTitle.addView(TextView(this).apply {
            text = "↑↓ تنقل  •  OK تشغيل"
            BlofyTvDesign.applyCaption(this)
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(dp(220), dp(42)))
        episodesPanel.addView(episodesTitle)

        episodeList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(3), dp(5), dp(3), dp(4))
            clipChildren = false
            clipToPadding = false
        }
        episodesPanel.addView(episodeList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(episodesPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            episodeAdapter = FocusTextAdapter(
                label = { episodeLabel(it) },
                onClick = { episode -> rememberEpisode(episode); openEpisode(provider, episode) },
                onFocus = ::rememberEpisode,
                itemKey = { it.key }
            )
            seasonAdapter = FocusTextAdapter(
                label = { season -> if (selectedSeason == season) "●  الموسم $season" else "الموسم $season" },
                onClick = ::selectSeason,
                onFocus = ::selectSeason,
                itemKey = { it.toString() }
            )
            episodeList.adapter = episodeAdapter
            seasonList.adapter = seasonAdapter

            val cached = dao.episodes(providerId, seriesId).first()
            launch { dao.episodes(providerId, seriesId).collect { renderEpisodes(it) } }
            if (cached.isEmpty()) syncEpisodes(provider)
            else {
                loadState = EpisodeLoadState.LOADED
                renderEpisodes(cached)
                updateStatus()
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (isFocusInside(seasonList) && requestEpisodeFocus()) return true
                KeyEvent.KEYCODE_DPAD_LEFT -> if (isFocusInside(episodeList) && requestSeasonFocus()) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        if (!::episodeAdapter.isInitialized) return
        lifecycleScope.launch { refreshWatchProgress(); refreshEpisodes(false) }
    }

    private suspend fun currentProvider(): ProviderEntity = BlofyDatabase.get(applicationContext).dao().provider(providerId)
        ?: throw IllegalStateException("قائمة التشغيل غير موجودة")

    private suspend fun syncEpisodes(provider: ProviderEntity) {
        if (syncInProgress) return
        syncInProgress = true
        loadState = EpisodeLoadState.LOADING
        retryButton.visibility = View.GONE
        updateStatus()
        val result = runCatching {
            withContext(Dispatchers.IO) {
                PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncSeriesEpisodes(provider, seriesId)
            }
        }
        result.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        syncInProgress = false
        loadState = result.fold(
            onSuccess = {
                when {
                    it.episodeCount > 0 -> EpisodeLoadState.LOADED
                    it.payloadPresent -> EpisodeLoadState.EMPTY_PROVIDER_RESPONSE
                    else -> EpisodeLoadState.INVALID_PROVIDER_RESPONSE
                }
            },
            onFailure = { EpisodeLoadState.ERROR }
        )
        refreshWatchProgress()
        retryButton.visibility = if (loadState.canRetry && allEpisodes.isEmpty()) View.VISIBLE else View.GONE
        updateStatus()
        if (retryButton.visibility == View.VISIBLE && DeviceClass.isTv(this)) retryButton.post { retryButton.requestFocus() }
    }

    private fun renderEpisodes(items: List<EpisodeEntity>) {
        allEpisodes = items.sortedWith(compareBy<EpisodeEntity> { it.season }.thenBy { it.episode })
        lifecycleScope.launch {
            refreshWatchProgress()
            val seasons = allEpisodes.map { it.season }.distinct().sorted()
            val rememberedSeason = FocusMemory.restore(this@EpisodesActivity, seasonMemoryKey())?.toIntOrNull()
            if (selectedSeason == null || selectedSeason !in seasons) {
                selectedSeason = rememberedSeason?.takeIf { it in seasons } ?: seasons.firstOrNull()
            }
            seasonAdapter.submit(seasons)
            refreshEpisodes(!restoredOnce)
            restoredOnce = true
            retryButton.visibility = if (allEpisodes.isEmpty() && loadState.canRetry) View.VISIBLE else View.GONE
            updateStatus()
        }
    }

    private suspend fun refreshWatchProgress() {
        if (allEpisodes.isEmpty()) { watchProgress.clear(); return }
        val states = BlofyDatabase.get(applicationContext).dao().watchStates(providerId).associateBy { it.contentKey }
        watchProgress.clear()
        allEpisodes.forEach { episode ->
            val watch = states[episode.key]
            watchProgress[episode.key] = when {
                watch == null || watch.positionMs <= 15_000L -> 0
                watch.completed -> 100
                watch.durationMs > 0 -> ((watch.positionMs * 100L) / watch.durationMs).toInt().coerceIn(1, 99)
                else -> 1
            }
        }
    }

    private fun episodeLabel(episode: EpisodeEntity): String {
        val progress = watchProgress[episode.key] ?: 0
        val progressText = when {
            progress >= 100 -> "   ✓ تمت المشاهدة"
            progress > 0 -> "   ◷ استئناف $progress%"
            else -> ""
        }
        val cleanTitle = episode.title.ifBlank { "الحلقة ${episode.episode}" }
        return "%02d   •   %s%s".format(episode.episode, cleanTitle, progressText)
    }

    private fun updateStatus() {
        val seasonEpisodes = selectedSeason?.let { season -> allEpisodes.count { it.season == season } } ?: 0
        seasonSummary.text = selectedSeason?.let { "الموسم $it\n$seasonEpisodes حلقة" } ?: "لا يوجد موسم"
        if (allEpisodes.isNotEmpty()) {
            val seasons = allEpisodes.map { it.season }.distinct().size
            status.text = if (syncInProgress) "جاري التحديث بالخلفية  •  ${allEpisodes.size} حلقة متاحة" else "$seasons موسم  •  ${allEpisodes.size} حلقة  •  جاهزة من الكاش"
            return
        }
        status.text = when (loadState) {
            EpisodeLoadState.LOADING -> "جاري تحميل الحلقات لأول مرة..."
            EpisodeLoadState.LOADED -> "جاري تجهيز الحلقات..."
            EpisodeLoadState.EMPTY_PROVIDER_RESPONSE -> "السيرفر لم يرسل حلقات لهذا المسلسل"
            EpisodeLoadState.INVALID_PROVIDER_RESPONSE -> "رد السيرفر غير مكتمل • أعد تحميل الحلقات"
            EpisodeLoadState.ERROR -> "تعذر تحميل الحلقات • تحقق من الاتصال ثم أعد المحاولة"
        }
    }

    private fun selectSeason(season: Int) {
        val changed = selectedSeason != season
        selectedSeason = season
        FocusMemory.save(this, seasonMemoryKey(), season.toString())
        seasonAdapter.submit(allEpisodes.map { it.season }.distinct().sorted())
        if (changed) refreshEpisodes(false)
        updateStatus()
    }

    private fun refreshEpisodes(restoreFocus: Boolean) {
        if (!::episodeAdapter.isInitialized) return
        val visible = selectedSeason?.let { season -> allEpisodes.filter { it.season == season }.sortedBy { it.episode } } ?: emptyList()
        episodeAdapter.submit(visible)
        updateStatus()
        if (!restoreFocus || !DeviceClass.isTv(this) || visible.isEmpty()) return
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post { episodeList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }

    private fun rememberEpisode(episode: EpisodeEntity) {
        FocusMemory.save(this, episodeMemoryKey(), episode.key)
        FocusMemory.save(this, seasonMemoryKey(), episode.season.toString())
    }

    private fun requestEpisodeFocus(): Boolean {
        if (!::episodeAdapter.isInitialized || episodeAdapter.itemCount == 0) return false
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val visible = selectedSeason?.let { s -> allEpisodes.filter { it.season == s }.sortedBy { it.episode } }.orEmpty()
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post { episodeList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }

    private fun requestSeasonFocus(): Boolean {
        if (!::seasonAdapter.isInitialized || seasonAdapter.itemCount == 0) return false
        val seasons = allEpisodes.map { it.season }.distinct().sorted()
        val index = seasons.indexOf(selectedSeason).let { if (it < 0) 0 else it }
        seasonList.scrollToPosition(index)
        seasonList.post { seasonList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }

    private fun isFocusInside(parent: View): Boolean {
        var child: View? = currentFocus
        while (child != null) {
            if (child === parent) return true
            child = child.parent as? View
        }
        return false
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity) {
        lifecycleScope.launch {
            val resume = BlofyDatabase.get(applicationContext).dao().watchState(episode.key)?.positionMs ?: 0L
            val url = ContentUrlResolver.episode(provider, episode)
            if (resume > 15_000L) {
                AlertDialog.Builder(this@EpisodesActivity)
                    .setTitle("الحلقة ${episode.episode} • ${episode.title}")
                    .setMessage("لديك مشاهدة سابقة. هل تريد الاستئناف أو البدء من البداية؟")
                    .setPositiveButton("استئناف") { _, _ -> launchEpisode(provider, episode, url, resume) }
                    .setNegativeButton("من البداية") { _, _ -> launchEpisode(provider, episode, url, 0L) }
                    .show()
            } else launchEpisode(provider, episode, url, 0L)
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, url: String, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season)
            putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        BlofyTvDesign.installTvFocus(this, dp(16).toFloat(), 1.035f, false)
        setOnClickListener { action() }
    }

    private fun panelBackground() = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xE81A1326.toInt(), 0xF00B0811.toInt())).apply {
        cornerRadius = dp(22).toFloat()
        setStroke(dp(1), 0x66563E70)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun seasonMemoryKey() = "episodes:$providerId:$seriesId:season"
    private fun episodeMemoryKey() = "episodes:$providerId:$seriesId:episode"

    private enum class EpisodeLoadState(val canRetry: Boolean) {
        LOADING(false), LOADED(false), EMPTY_PROVIDER_RESPONSE(true), INVALID_PROVIDER_RESPONSE(true), ERROR(true)
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_SERIES_NAME = "series_name"
    }
}
