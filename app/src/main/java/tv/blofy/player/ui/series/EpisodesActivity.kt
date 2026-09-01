package tv.blofy.player.ui.series

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
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
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.player.PlayerActivity

class EpisodesActivity : AppCompatActivity() {
    private lateinit var episodeAdapter: FocusTextAdapter<EpisodeEntity>
    private lateinit var seasonAdapter: FocusTextAdapter<Int>
    private lateinit var seasonList: RecyclerView
    private lateinit var episodeList: RecyclerView
    private lateinit var status: TextView
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
            setPadding(dp(28), dp(22), dp(28), dp(24))
            background = AppCompatResources.getDrawable(this@EpisodesActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = seriesName.ifBlank { "الحلقات" }
            textSize = 30f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
            setPadding(dp(8), 0, 0, dp(4))
        })
        status = TextView(this).apply {
            text = "جاري تحميل الحلقات..."; textSize = 14f; setTextColor(SOFT); gravity = Gravity.RIGHT
            setPadding(dp(8), 0, 0, dp(12))
        }
        root.addView(status)
        retryButton = actionButton("إعادة تحميل الحلقات") { lifecycleScope.launch { syncEpisodes(currentProvider()) } }.apply { visibility = View.GONE }
        root.addView(retryButton, LinearLayout.LayoutParams(dp(250), dp(64)).apply { bottomMargin = dp(10); gravity = Gravity.RIGHT })

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR }
        episodeList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity); itemAnimator = null; setHasFixedSize(true)
            setPadding(dp(8), dp(8), dp(8), dp(8)); background = panelBackground()
        }
        seasonList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity); itemAnimator = null; setHasFixedSize(true)
            setPadding(dp(8), dp(8), dp(8), dp(8)); background = panelBackground()
        }
        body.addView(episodeList, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(18) })
        body.addView(seasonList, LinearLayout.LayoutParams(dp(260), LinearLayout.LayoutParams.MATCH_PARENT))
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
                label = { season -> "الموسم $season" },
                onClick = ::selectSeason,
                onFocus = ::selectSeason,
                itemKey = { it.toString() }
            )
            episodeList.adapter = episodeAdapter
            seasonList.adapter = seasonAdapter
            installTvFocusBridge()
            launch { dao.episodes(providerId, seriesId).collect { renderEpisodes(it) } }
            syncEpisodes(provider)
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::episodeAdapter.isInitialized) return
        lifecycleScope.launch { refreshWatchProgress(); refreshEpisodes(false) }
    }

    private fun installTvFocusBridge() {
        if (!DeviceClass.isTv(this)) return
        seasonList.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_LEFT) return@setOnKeyListener false
            focusEpisodeList()
        }
        episodeList.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_RIGHT) return@setOnKeyListener false
            focusSelectedSeason()
        }
    }

    private fun focusEpisodeList(): Boolean {
        if (episodeAdapter.itemCount <= 0) return false
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val visible = selectedSeason?.let { s -> allEpisodes.filter { it.season == s }.sortedBy { it.episode } } ?: emptyList()
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post { episodeList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }

    private fun focusSelectedSeason(): Boolean {
        if (seasonAdapter.itemCount <= 0) return false
        val seasons = allEpisodes.map { it.season }.distinct().sorted()
        val index = seasons.indexOf(selectedSeason).let { if (it < 0) 0 else it }
        seasonList.scrollToPosition(index)
        seasonList.post { seasonList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
        return true
    }

    private suspend fun currentProvider(): ProviderEntity = BlofyDatabase.get(applicationContext).dao().provider(providerId)
        ?: throw IllegalStateException("قائمة التشغيل غير موجودة")

    private suspend fun syncEpisodes(provider: ProviderEntity) {
        if (syncInProgress) return
        syncInProgress = true; loadState = EpisodeLoadState.LOADING; retryButton.visibility = View.GONE; updateStatus()
        val result = runCatching {
            withContext(Dispatchers.IO) { PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncSeriesEpisodes(provider, seriesId) }
        }
        result.exceptionOrNull()?.let { if (it is CancellationException) throw it }
        syncInProgress = false
        loadState = result.fold(
            onSuccess = { when { it.episodeCount > 0 -> EpisodeLoadState.LOADED; it.payloadPresent -> EpisodeLoadState.EMPTY_PROVIDER_RESPONSE; else -> EpisodeLoadState.INVALID_PROVIDER_RESPONSE } },
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
            seasonAdapter.submit(seasons)
            val rememberedSeason = FocusMemory.restore(this@EpisodesActivity, seasonMemoryKey())?.toIntOrNull()
            if (selectedSeason == null || selectedSeason !in seasons) selectedSeason = rememberedSeason?.takeIf { it in seasons } ?: seasons.firstOrNull()
            refreshEpisodes(!restoredOnce); restoredOnce = true
            retryButton.visibility = if (allEpisodes.isEmpty() && loadState.canRetry) View.VISIBLE else View.GONE
            updateStatus()
        }
    }

    private suspend fun refreshWatchProgress() {
        if (allEpisodes.isEmpty()) {
            watchProgress.clear()
            return
        }
        val dao = BlofyDatabase.get(applicationContext).dao()
        val states = dao.watchStates(providerId).associateBy { it.contentKey }
        watchProgress.clear()
        allEpisodes.forEach { e ->
            val w = states[e.key]
            watchProgress[e.key] = when {
                w == null || w.positionMs <= 15_000L -> 0
                w.completed -> 100
                w.durationMs > 0 -> ((w.positionMs * 100L) / w.durationMs).toInt().coerceIn(1, 99)
                else -> 1
            }
        }
    }

    private fun episodeLabel(e: EpisodeEntity): String {
        val progress = watchProgress[e.key] ?: 0
        val suffix = when {
            progress >= 100 -> "  ✓ تمت المشاهدة"
            progress > 0 -> "  •  استئناف $progress%"
            else -> ""
        }
        return "الحلقة ${e.episode}  •  ${e.title}$suffix"
    }

    private fun updateStatus() {
        if (allEpisodes.isNotEmpty()) {
            val seasons = allEpisodes.map { it.season }.distinct().size
            status.text = if (syncInProgress) "جاري تحديث الحلقات...  •  ${allEpisodes.size} حلقة محفوظة" else "$seasons موسم  •  ${allEpisodes.size} حلقة"
            return
        }
        status.text = when (loadState) {
            EpisodeLoadState.LOADING -> "جاري تحميل الحلقات..."
            EpisodeLoadState.LOADED -> "جاري تجهيز الحلقات..."
            EpisodeLoadState.EMPTY_PROVIDER_RESPONSE -> "السيرفر لم يرسل حلقات لهذا المسلسل • حاول مرة أخرى"
            EpisodeLoadState.INVALID_PROVIDER_RESPONSE -> "رد السيرفر غير مكتمل • أعد تحميل الحلقات"
            EpisodeLoadState.ERROR -> "تعذر تحميل الحلقات • تحقق من الاتصال ثم أعد المحاولة"
        }
    }

    private fun selectSeason(season: Int) {
        val changed = selectedSeason != season; selectedSeason = season
        FocusMemory.save(this, seasonMemoryKey(), season.toString())
        if (changed) refreshEpisodes(false)
    }

    private fun refreshEpisodes(restoreFocus: Boolean) {
        if (!::episodeAdapter.isInitialized) return
        val visible = selectedSeason?.let { s -> allEpisodes.filter { it.season == s }.sortedBy { it.episode } } ?: emptyList()
        episodeAdapter.submit(visible)
        if (!restoreFocus || !DeviceClass.isTv(this) || visible.isEmpty()) return
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post { episodeList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }

    private fun rememberEpisode(episode: EpisodeEntity) {
        FocusMemory.save(this, episodeMemoryKey(), episode.key); FocusMemory.save(this, seasonMemoryKey(), episode.season.toString())
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity) {
        lifecycleScope.launch {
            val resume = BlofyDatabase.get(applicationContext).dao().watchState(episode.key)?.positionMs ?: 0L
            val url = ContentUrlResolver.episode(provider, episode)
            if (resume > 15_000L) AlertDialog.Builder(this@EpisodesActivity)
                .setTitle("الحلقة ${episode.episode} • ${episode.title}")
                .setMessage("لديك مشاهدة سابقة. هل تريد الاستئناف أو البدء من البداية؟")
                .setPositiveButton("استئناف") { _, _ -> launchEpisode(provider, episode, url, resume) }
                .setNegativeButton("من البداية") { _, _ -> launchEpisode(provider, episode, url, 0L) }
                .show()
            else launchEpisode(provider, episode, url, 0L)
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, url: String, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode"); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport); putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects); putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume); putExtra(PlayerActivity.EXTRA_TITLE, episode.title); putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season); putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f; isFocusable = true; setTextColor(Color.WHITE); background = buttonBackground(false)
        setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused); view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(90).start() }
        setOnClickListener { action() }
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = dp(18).toFloat()
        setColor(CLASSIC_SURFACE)
        setStroke(dp(1), CLASSIC_STROKE)
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(15).toFloat()
        setColor(if (focused) CLASSIC_FOCUS else CLASSIC_SURFACE)
        setStroke(if (focused) dp(2) else dp(1), if (focused) CLASSIC_FOCUS_STROKE else CLASSIC_STROKE)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun seasonMemoryKey() = "episodes:$providerId:$seriesId:season"
    private fun episodeMemoryKey() = "episodes:$providerId:$seriesId:episode"

    private enum class EpisodeLoadState(val canRetry: Boolean) { LOADING(false), LOADED(false), EMPTY_PROVIDER_RESPONSE(true), INVALID_PROVIDER_RESPONSE(true), ERROR(true) }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"; const val EXTRA_SERIES_ID = "series_id"; const val EXTRA_SERIES_NAME = "series_name"
        private val SOFT = Color.rgb(188, 182, 205)
        private val CLASSIC_SURFACE = Color.rgb(17, 16, 30)
        private val CLASSIC_STROKE = Color.rgb(69, 55, 88)
        private val CLASSIC_FOCUS = Color.rgb(72, 42, 120)
        private val CLASSIC_FOCUS_STROKE = Color.rgb(188, 132, 255)
    }
}
