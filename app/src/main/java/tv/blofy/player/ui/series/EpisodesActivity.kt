package tv.blofy.player.ui.series

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        seriesId = intent.getStringExtra(EXTRA_SERIES_ID).orEmpty()
        val seriesName = intent.getStringExtra(EXTRA_SERIES_NAME).orEmpty()
        if (providerId.isBlank() || seriesId.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(34, 24, 34, 24)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = seriesName.ifBlank { "الحلقات" }
            textSize = 29f
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(8, 0, 0, 6)
        })
        status = TextView(this).apply {
            text = "جاري تحميل الحلقات..."
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(8, 0, 0, 8)
        }
        root.addView(status)
        retryButton = Button(this).apply {
            text = "إعادة تحميل الحلقات"
            isAllCaps = false
            visibility = View.GONE
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(91, 45, 175))
        }
        root.addView(retryButton, LinearLayout.LayoutParams(250, 64).apply { bottomMargin = 10 })

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        seasonList = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@EpisodesActivity) }
        episodeList = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@EpisodesActivity) }
        body.addView(seasonList, LinearLayout.LayoutParams(260, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 18 })
        body.addView(episodeList, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            episodeAdapter = FocusTextAdapter(
                label = { "الحلقة ${it.episode}  •  ${it.title}" },
                onClick = { episode -> rememberEpisode(episode); openEpisode(provider, episode) },
                onFocus = ::rememberEpisode
            )
            seasonAdapter = FocusTextAdapter(
                label = { "الموسم $it" },
                onClick = ::selectSeason,
                onFocus = ::selectSeason
            )
            episodeList.adapter = episodeAdapter
            seasonList.adapter = seasonAdapter

            retryButton.setOnClickListener {
                lifecycleScope.launch { syncEpisodes(provider) }
            }

            launch {
                dao.episodes(providerId, seriesId).collect { items ->
                    renderEpisodes(items)
                }
            }
            syncEpisodes(provider)
        }
    }

    private suspend fun syncEpisodes(provider: ProviderEntity) {
        if (syncInProgress) return
        syncInProgress = true
        loadState = EpisodeLoadState.LOADING
        retryButton.visibility = View.GONE
        updateStatus()

        val result = runCatching {
            withContext(Dispatchers.IO) {
                PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao())
                    .syncSeriesEpisodes(provider, seriesId)
            }
        }
        result.exceptionOrNull()?.let { failure ->
            if (failure is CancellationException) throw failure
        }

        syncInProgress = false
        loadState = result.fold(
            onSuccess = { sync ->
                when {
                    sync.episodeCount > 0 -> EpisodeLoadState.LOADED
                    sync.payloadPresent -> EpisodeLoadState.EMPTY_PROVIDER_RESPONSE
                    else -> EpisodeLoadState.INVALID_PROVIDER_RESPONSE
                }
            },
            onFailure = { EpisodeLoadState.ERROR }
        )
        retryButton.visibility = if (loadState.canRetry && allEpisodes.isEmpty()) View.VISIBLE else View.GONE
        updateStatus()
        if (retryButton.visibility == View.VISIBLE && DeviceClass.isTv(this)) {
            retryButton.post { retryButton.requestFocus() }
        }
    }

    private fun renderEpisodes(items: List<EpisodeEntity>) {
        allEpisodes = items.sortedWith(compareBy<EpisodeEntity> { it.season }.thenBy { it.episode })
        val seasonValues = allEpisodes.map { it.season }.distinct().sorted()
        seasonAdapter.submit(seasonValues)
        val rememberedSeason = FocusMemory.restore(this, seasonMemoryKey())?.toIntOrNull()
        if (selectedSeason == null || selectedSeason !in seasonValues) {
            selectedSeason = rememberedSeason?.takeIf { it in seasonValues } ?: seasonValues.firstOrNull()
        }
        refreshEpisodes(restoreFocus = !restoredOnce)
        restoredOnce = true
        retryButton.visibility = if (allEpisodes.isEmpty() && loadState.canRetry) View.VISIBLE else View.GONE
        updateStatus()
    }

    private fun updateStatus() {
        if (allEpisodes.isNotEmpty()) {
            val seasons = allEpisodes.map { it.season }.distinct().size
            status.text = if (syncInProgress) {
                "جاري تحديث الحلقات...  •  ${allEpisodes.size} حلقة محفوظة"
            } else {
                "$seasons موسم  •  ${allEpisodes.size} حلقة"
            }
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
        val changed = selectedSeason != season
        selectedSeason = season
        FocusMemory.save(this, seasonMemoryKey(), season.toString())
        if (changed) refreshEpisodes(restoreFocus = false)
    }

    private fun refreshEpisodes(restoreFocus: Boolean) {
        if (!::episodeAdapter.isInitialized) return
        val season = selectedSeason
        val visible = if (season == null) emptyList() else allEpisodes.filter { it.season == season }.sortedBy { it.episode }
        episodeAdapter.submit(visible)
        if (!restoreFocus || !DeviceClass.isTv(this) || visible.isEmpty()) return
        val remembered = FocusMemory.restore(this, episodeMemoryKey())
        val index = visible.indexOfFirst { it.key == remembered }.let { if (it < 0) 0 else it }
        episodeList.scrollToPosition(index)
        episodeList.post {
            val holder = episodeList.findViewHolderForAdapterPosition(index)
            holder?.itemView?.requestFocus()
        }
    }

    private fun rememberEpisode(episode: EpisodeEntity) {
        FocusMemory.save(this, episodeMemoryKey(), episode.key)
        FocusMemory.save(this, seasonMemoryKey(), episode.season.toString())
    }

    private fun openEpisode(provider: ProviderEntity, episode: EpisodeEntity) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val resume = dao.watchState(episode.key)?.positionMs ?: 0L
            val url = ContentUrlResolver.episode(provider, episode)
            if (resume > 15_000L) {
                AlertDialog.Builder(this@EpisodesActivity)
                    .setTitle(episode.title)
                    .setMessage("هل تريد استئناف الحلقة أو البدء من البداية؟")
                    .setPositiveButton("استئناف") { _, _ -> launchEpisode(provider, episode, url, resume) }
                    .setNegativeButton("من البداية") { _, _ -> launchEpisode(provider, episode, url, 0L) }
                    .show()
            } else launchEpisode(provider, episode, url, resume)
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

    private fun seasonMemoryKey() = "episodes:$providerId:$seriesId:season"
    private fun episodeMemoryKey() = "episodes:$providerId:$seriesId:episode"

    private enum class EpisodeLoadState(val canRetry: Boolean) {
        LOADING(false),
        LOADED(false),
        EMPTY_PROVIDER_RESPONSE(true),
        INVALID_PROVIDER_RESPONSE(true),
        ERROR(true)
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_SERIES_NAME = "series_name"
    }
}
