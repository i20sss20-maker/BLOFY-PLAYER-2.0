package tv.blofy.player.ui.series

import tv.blofy.player.ui.common.ContentPresentation

import tv.blofy.player.ui.common.CinemaStyle

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.SystemClock
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.core.security.ContentAccessActivity
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
import tv.blofy.player.core.diagnostics.PlaybackDiagnostics
import tv.blofy.player.core.diagnostics.PlaybackDiagnosticsUploader
import tv.blofy.player.core.diagnostics.PlaybackFailureDetails
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentScreenStyle
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.settings.RuntimeSettings

class EpisodesActivity : ContentAccessActivity() {
    private lateinit var episodeAdapter: EpisodeCardAdapter
    private lateinit var seasonAdapter: FocusTextAdapter<Int>
    private lateinit var seasonList: RecyclerView
    private lateinit var episodeList: RecyclerView
    private lateinit var episodeBody: LinearLayout
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
    private lateinit var deviceKind: DeviceClass.Kind

    override fun onContentReady(savedInstanceState: Bundle?) {
        deviceKind = DeviceClass.detect(this)
        providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        seriesId = intent.getStringExtra(EXTRA_SERIES_ID).orEmpty()
        val seriesName = intent.getStringExtra(EXTRA_SERIES_NAME).orEmpty()
        val seriesArt = intent.getStringExtra(EXTRA_SERIES_ART)
        if (providerId.isBlank() || seriesId.isBlank()) { finish(); return }

        val compact = deviceKind == DeviceClass.Kind.PHONE
        val tablet = deviceKind == DeviceClass.Kind.TABLET
        val uiDirection = resources.configuration.layoutDirection
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            setPadding(
                dp(if (compact) 14 else if (tablet) 22 else 30),
                dp(if (compact) 14 else 22),
                dp(if (compact) 14 else if (tablet) 22 else 30),
                dp(if (compact) 16 else 24)
            )
            background = AppCompatResources.getDrawable(this@EpisodesActivity, R.drawable.blofy_home_background)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = uiDirection
            setPadding(dp(if (compact) 12 else 16), dp(if (compact) 10 else 12), dp(if (compact) 12 else 16), dp(if (compact) 10 else 12))
            setBackgroundColor(Color.TRANSPARENT)
        }
        val heroArt = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = ContentScreenStyle.softSurface(this@EpisodesActivity, false, 14)
            clipToOutline = true
            setImageResource(R.drawable.blofy_logo)
        }
        if (!seriesArt.isNullOrBlank()) ArtworkLoader.load(heroArt, seriesArt)
        header.addView(heroArt, LinearLayout.LayoutParams(dp(if (compact) 86 else 106), dp(if (compact) 58 else 68)).apply {
            marginEnd = dp(if (compact) 10 else 16)
        })
        val headerCopy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            addView(TextView(this@EpisodesActivity).apply {
                text = "BLOFY SERIES"
                textSize = if (compact) 10.5f else 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.LabelTypeface
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.START
            })
            addView(TextView(this@EpisodesActivity).apply {
                text = ContentPresentation.title(seriesName, "series").ifBlank { getString(R.string.episodes) }
                textSize = when (deviceKind) {
                    DeviceClass.Kind.TV -> 24f
                    DeviceClass.Kind.TABLET -> 25f
                    DeviceClass.Kind.PHONE -> 20f
                }
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.START
                includeFontPadding = false
                maxLines = 2
            })
            status = TextView(this@EpisodesActivity).apply {
                text = getString(R.string.episodes_preparing)
                textSize = if (compact) 11.5f else 12.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                maxLines = 2
                setPadding(0, dp(3), 0, 0)
            }
            addView(status)
        }
        header.addView(headerCopy, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(header, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
        retryButton = actionButton(getString(R.string.episodes_retry)) {
            lifecycleScope.launch { syncEpisodes(currentProvider()) }
        }.apply { visibility = View.GONE }
        root.addView(retryButton, LinearLayout.LayoutParams(
            if (compact) LinearLayout.LayoutParams.MATCH_PARENT else dp(250),
            dp(if (compact) 48 else CinemaStyle.ActionHeight)
        ).apply {
            bottomMargin = dp(10)
            gravity = Gravity.START
        })

        episodeBody = LinearLayout(this).apply {
            orientation = if (compact) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            layoutDirection = if (compact) uiDirection else View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }
        seasonList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity)
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(if (compact) 4 else 6), dp(4), dp(if (compact) 4 else 6), dp(4))
            setBackgroundColor(Color.TRANSPARENT)
            clipChildren = false
            clipToPadding = false
        }
        episodeList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpisodesActivity)
            itemAnimator = null
            setHasFixedSize(true)
            setPadding(dp(if (compact) 4 else 6), dp(4), dp(if (compact) 4 else 6), dp(4))
            setBackgroundColor(Color.TRANSPARENT)
            clipChildren = false
            clipToPadding = false
        }
        if (compact) {
            episodeBody.addView(seasonList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(116)).apply { bottomMargin = dp(10) })
            episodeBody.addView(episodeList, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        } else {
            val seasonWidth = if (tablet) 160 else 158
            episodeBody.addView(seasonList, LinearLayout.LayoutParams(dp(seasonWidth), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(16) })
            episodeBody.addView(episodeList, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        }
        root.addView(episodeBody, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            episodeAdapter = EpisodeCardAdapter(
                seriesName = seriesName,
                seriesArt = seriesArt,
                onClick = { episode -> rememberEpisode(episode); openEpisode(provider, episode) },
                onFocus = ::rememberEpisode
            )
            seasonAdapter = FocusTextAdapter(
                label = { season -> getString(R.string.episodes_season, season) },
                onClick = ::selectSeason,
                onFocus = ::selectSeason,
                itemKey = { it.toString() }
            )
            episodeList.adapter = episodeAdapter
            seasonList.adapter = seasonAdapter
            installTvFocusBridge()

            val cached = dao.episodes(providerId, seriesId).first()
            launch { dao.episodes(providerId, seriesId).collect { renderEpisodes(it) } }
            if (cached.isEmpty()) {
                // User-selected series outranks the bulk background queue. Fetch it immediately.
                // The Room collector above renders episodes as soon as they are committed.
                loadState = EpisodeLoadState.LOADING
                updateStatus()
                syncEpisodes(provider)
            } else {
                loadState = EpisodeLoadState.LOADED
                status.text = getString(R.string.episodes_cached)
            }
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
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_RIGHT) return@setOnKeyListener false
            focusEpisodeList()
        }
        episodeList.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_LEFT) return@setOnKeyListener false
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
        ?: throw IllegalStateException(getString(R.string.catalog_provider_not_found))

    private suspend fun syncEpisodes(provider: ProviderEntity) {
        if (syncInProgress) return
        syncInProgress = true
        loadState = EpisodeLoadState.LOADING
        retryButton.visibility = View.GONE
        updateStatus()
        val requestStartedAt = SystemClock.elapsedRealtime()
        val result = runCatching {
            withContext(Dispatchers.IO) {
                PlaylistManager(XtreamClient.episodeApi, BlofyDatabase.get(applicationContext).dao()).syncSeriesEpisodes(provider, seriesId)
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
            onFailure = { error ->
                val metric = PlaybackDiagnostics.begin(provider.id, "series", provider.baseUrl)
                PlaybackDiagnosticsUploader.enqueue(applicationContext, PlaybackDiagnostics.error(
                    metric, PlaybackFailureDetails.requestErrorCode(error),
                    PlaybackFailureDetails.describe(error, "episode_catalog")
                ))
                EpisodeLoadState.ERROR
            }
        )
        if (result.isSuccess) {
            val metric = PlaybackDiagnostics.begin(provider.id, "series", provider.baseUrl)
            PlaybackDiagnosticsUploader.enqueue(applicationContext, metric.copy(
                errorMessage = "phase=episode_catalog;elapsed_ms=" +
                    (SystemClock.elapsedRealtime() - requestStartedAt) +
                    ";episodes=" + (result.getOrNull()?.episodeCount ?: 0)
            ))
        }
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
            if (selectedSeason == null || selectedSeason !in seasons) {
                selectedSeason = rememberedSeason?.takeIf { it in seasons } ?: seasons.firstOrNull()
            }
            refreshEpisodes(!restoredOnce)
            restoredOnce = true
            retryButton.visibility = if (allEpisodes.isEmpty() && loadState.canRetry) View.VISIBLE else View.GONE
            updateStatus()
            adjustPaneHeight()
        }
    }

    private suspend fun refreshWatchProgress() {
        if (allEpisodes.isEmpty()) {
            watchProgress.clear()
            if (::episodeAdapter.isInitialized) episodeAdapter.setProgress(watchProgress)
            return
        }
        val dao = BlofyDatabase.get(applicationContext).dao()
        val states = dao.watchStatesForSeries(providerId, seriesId).associateBy { it.contentKey }
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
        if (::episodeAdapter.isInitialized) episodeAdapter.setProgress(watchProgress)
    }

    private fun updateStatus() {
        if (allEpisodes.isNotEmpty()) {
            val seasons = allEpisodes.map { it.season }.distinct().size
            status.text = if (syncInProgress) {
                getString(R.string.episodes_updating, allEpisodes.size)
            } else {
                val seasonLabel = resources.getQuantityString(
                    R.plurals.details_seasons_count_plural, seasons, seasons
                )
                val episodeLabel = resources.getQuantityString(
                    R.plurals.details_episodes_count_plural, allEpisodes.size, allEpisodes.size
                )
                "$seasonLabel • $episodeLabel"
            }
            return
        }
        status.text = when (loadState) {
            EpisodeLoadState.LOADING -> getString(R.string.episodes_loading_first)
            EpisodeLoadState.LOADED -> getString(R.string.episodes_preparing)
            EpisodeLoadState.EMPTY_PROVIDER_RESPONSE -> getString(R.string.episodes_empty_response)
            EpisodeLoadState.INVALID_PROVIDER_RESPONSE -> getString(R.string.episodes_invalid_response)
            EpisodeLoadState.ERROR -> getString(R.string.episodes_load_error)
        }
    }

    private fun selectSeason(season: Int) {
        val changed = selectedSeason != season
        selectedSeason = season
        FocusMemory.save(this, seasonMemoryKey(), season.toString())
        if (changed) refreshEpisodes(false)
    }

    private fun refreshEpisodes(restoreFocus: Boolean) {
        if (!::episodeAdapter.isInitialized) return
        val visible = selectedSeason?.let { s -> allEpisodes.filter { it.season == s }.sortedBy { it.episode } } ?: emptyList()
        episodeAdapter.submit(visible)
        episodeAdapter.setProgress(watchProgress)
        adjustPaneHeight()
        if (!restoreFocus || !DeviceClass.isTv(this) || visible.isEmpty()) return
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post { episodeList.findViewHolderForAdapterPosition(index)?.itemView?.requestFocus() }
    }

    private fun adjustPaneHeight() {
        if (!::episodeBody.isInitialized || deviceKind == DeviceClass.Kind.PHONE) return
        val seasonCount = allEpisodes.map { it.season }.distinct().size
        val visibleCount = selectedSeason?.let { season -> allEpisodes.count { it.season == season } } ?: 0
        val maxHeight = dp((resources.configuration.screenHeightDp - 210).coerceIn(230, 470))
        val seasonNeed = dp(18 + seasonCount.coerceAtMost(7) * 54)
        val episodeNeed = dp(14 + visibleCount.coerceAtMost(5) * 91)
        val target = maxOf(dp(126), seasonNeed, episodeNeed).coerceAtMost(maxHeight)
        episodeBody.layoutParams = (episodeBody.layoutParams as LinearLayout.LayoutParams).apply {
            height = target
            weight = 0f
        }
        seasonList.layoutParams = (seasonList.layoutParams as LinearLayout.LayoutParams).apply {
            height = target
        }
        episodeList.layoutParams = (episodeList.layoutParams as LinearLayout.LayoutParams).apply {
            height = target
        }
        episodeBody.requestLayout()
    }

    private fun rememberEpisode(episode: EpisodeEntity) {
        FocusMemory.save(this, episodeMemoryKey(), episode.key)
        FocusMemory.save(this, seasonMemoryKey(), episode.season.toString())
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity) {
        lifecycleScope.launch {
            val resume = BlofyDatabase.get(applicationContext).dao().watchState(episode.key)?.positionMs ?: 0L
            val url = ContentUrlResolver.episode(provider, episode)
            if (resume > 15_000L) {
                if (RuntimeSettings.askBeforeResume(this@EpisodesActivity)) {
                    AlertDialog.Builder(this@EpisodesActivity)
                        .setTitle(getString(R.string.episodes_current_title, episode.episode, ContentPresentation.title(episode.title, "episode")))
                        .setMessage(getString(R.string.episodes_resume_message))
                        .setPositiveButton(getString(R.string.episodes_resume)) { _, _ -> launchEpisode(provider, episode, url, resume) }
                        .setNegativeButton(getString(R.string.episodes_start_over)) { _, _ -> launchEpisode(provider, episode, url, 0L) }
                        .show()
                } else {
                    launchEpisode(provider, episode, url, resume)
                }
            } else {
                launchEpisode(provider, episode, url, 0L)
            }
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
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(episode)))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season)
            putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun seasonMemoryKey() = "episodes:$providerId:$seriesId:season"
    private fun episodeMemoryKey() = "episodes:$providerId:$seriesId:episode"

    private enum class EpisodeLoadState(val canRetry: Boolean) {
        LOADING(false), LOADED(false), EMPTY_PROVIDER_RESPONSE(true), INVALID_PROVIDER_RESPONSE(true), ERROR(true)
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_SERIES_NAME = "series_name"
        const val EXTRA_SERIES_ART = "series_art"
    }
}
