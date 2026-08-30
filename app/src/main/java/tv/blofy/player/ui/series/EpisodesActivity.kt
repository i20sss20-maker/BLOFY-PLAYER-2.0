package tv.blofy.player.ui.series

import android.app.AlertDialog
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.playback.ContentUrlResolver
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
    private var allEpisodes: List<EpisodeEntity> = emptyList()
    private var selectedSeason: Int? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val seriesId = intent.getStringExtra(EXTRA_SERIES_ID).orEmpty()
        val seriesName = intent.getStringExtra(EXTRA_SERIES_NAME).orEmpty()
        if (providerId.isBlank() || seriesId.isBlank()) {
            finish(); return
        }

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
        val status = TextView(this).apply {
            text = "جاري تحميل الحلقات..."
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(8, 0, 0, 14)
        }
        root.addView(status)

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val seasons = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@EpisodesActivity) }
        val episodes = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@EpisodesActivity) }
        body.addView(seasons, LinearLayout.LayoutParams(260, LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = 18 })
        body.addView(episodes, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }

            episodeAdapter = FocusTextAdapter(
                label = { "الحلقة ${it.episode}  •  ${it.title}" },
                onClick = { episode -> openEpisode(provider, episode) }
            )
            seasonAdapter = FocusTextAdapter(
                label = { "الموسم $it" },
                onClick = ::selectSeason,
                onFocus = ::selectSeason
            )
            episodes.adapter = episodeAdapter
            seasons.adapter = seasonAdapter

            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncSeriesEpisodes(provider, seriesId)
                }
            }.onFailure { status.text = "عرض البيانات المحفوظة" }

            dao.episodes(providerId, seriesId).collect { items ->
                allEpisodes = items.sortedWith(compareBy<EpisodeEntity> { it.season }.thenBy { it.episode })
                val seasonValues = allEpisodes.map { it.season }.distinct().sorted()
                seasonAdapter.submit(seasonValues)
                if (selectedSeason == null || selectedSeason !in seasonValues) selectedSeason = seasonValues.firstOrNull()
                refreshEpisodes()
                status.text = if (items.isEmpty()) "لا توجد حلقات" else "${seasonValues.size} موسم  •  ${items.size} حلقة"
            }
        }
    }

    private fun selectSeason(season: Int) {
        if (selectedSeason == season) return
        selectedSeason = season
        refreshEpisodes()
    }

    private fun refreshEpisodes() {
        if (!::episodeAdapter.isInitialized) return
        val season = selectedSeason
        episodeAdapter.submit(if (season == null) emptyList() else allEpisodes.filter { it.season == season }.sortedBy { it.episode })
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
            } else {
                launchEpisode(provider, episode, url, resume)
            }
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, url: String, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode")
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
        })
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_SERIES_NAME = "series_name"
    }
}
