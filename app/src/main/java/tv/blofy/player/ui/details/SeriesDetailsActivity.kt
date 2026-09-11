package tv.blofy.player.ui.details

import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import tv.blofy.player.ui.common.CinemaStyle
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity

class SeriesDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) {
            finish()
            return
        }

        val layout = DetailsLayout(this)
        val backdrop = layout.backdrop
        val poster = layout.poster
        val panel = layout.info

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val metadata = withContext(Dispatchers.IO) {
                XtreamMetadataFallback.series(provider, stream)
            }

            ArtworkLoader.loadPriority(backdrop, listOf(metadata?.backdropUrl, stream.backdrop, stream.icon))
            ArtworkLoader.loadPriority(poster, listOf(metadata?.posterUrl, stream.icon, stream.backdrop))

            val allEpisodes = dao.episodes(providerId, stream.remoteId).first()
            val resumeItems = mutableListOf<Resume>()
            val statesByKey = dao.watchStatesForSeries(providerId, stream.remoteId).associateBy { it.contentKey }
            allEpisodes.forEach { episode ->
                val state = statesByKey[episode.key] ?: return@forEach
                if (!state.completed && state.positionMs > 15_000L) {
                    resumeItems += Resume(episode, state.positionMs, state.durationMs, state.updatedAt)
                }
            }
            val resume = resumeItems.maxByOrNull { it.updatedAt }
            val seasons = allEpisodes.map { it.season }.distinct().size

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "BLOFY SERIES"
                textSize = 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.END
            })

            val title = ContentPresentation.title(metadata?.title?.takeIf(String::isNotBlank) ?: stream.name, stream.kind)
            metadata?.logoUrl?.takeIf(String::isNotBlank)?.let { logoUrl ->
                val logo = ImageView(this@SeriesDetailsActivity).apply {
                    scaleType = ImageView.ScaleType.FIT_END
                    adjustViewBounds = true
                    contentDescription = title
                }
                panel.addView(logo, layout.logoParams())
                ArtworkLoader.load(logo, logoUrl)
            }
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = title
                textSize = if (metadata?.logoUrl.isNullOrBlank()) 28f else 18f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
                maxLines = 2
                includeFontPadding = false
                alpha = if (metadata?.logoUrl.isNullOrBlank()) 1f else .9f
            })

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = buildList {
                    add(getString(R.string.details_series_type))
                    addAll(ContentPresentation.of(stream).badges)
                    (metadata?.releaseDate?.take(4) ?: stream.year)?.takeIf(String::isNotBlank)?.let(::add)
                    if (seasons > 0) add(getString(R.string.details_seasons_count, seasons))
                    if (allEpisodes.isNotEmpty()) add(getString(R.string.details_episodes_count, allEpisodes.size))
                    metadata?.runtimeMinutes?.takeIf { it > 0 }?.let { add(getString(R.string.details_minutes, it)) }
                    metadata?.rating?.let { add("★ %.1f/10".format(java.util.Locale.US, it)) }
                        ?: stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    val genres = metadata?.genres?.filter(String::isNotBlank).orEmpty()
                    if (genres.isNotEmpty()) add(genres.take(3).joinToString(" / "))
                    else stream.genre?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.countries?.takeIf { it.isNotEmpty() }?.let { add(it.take(2).joinToString(" / ")) }
                    metadata?.originalLanguage?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                }.joinToString("   •   ")
                textSize = 13.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(0xFFE8D8FA.toInt())
                gravity = Gravity.END
                setPadding(0, dp(7), 0, dp(10))
            })

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = getString(R.string.details_story)
                textSize = 13f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.END
                setPadding(0, 0, 0, dp(3))
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = metadata?.overview?.takeIf(String::isNotBlank)
                    ?: stream.plot?.takeIf(String::isNotBlank)
                    ?: getString(R.string.details_series_no_description)
                textSize = 15f
                typeface = BlofyTvDesign.BodyTypeface
                maxLines = 7
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.END
                setLineSpacing(0f, 1.16f)
                setPadding(0, 0, 0, dp(8))
            })

            if (!metadata?.crew.isNullOrEmpty()) {
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = metadata?.crew.orEmpty().joinToString("   •   ") { "${it.job}: ${it.name}" }
                    textSize = 11.5f
                    typeface = BlofyTvDesign.MediumTypeface
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.END
                    maxLines = 2
                    setPadding(0, 0, 0, dp(7))
                })
            }

            resume?.let { currentResume ->
                val progress = if (currentResume.durationMs > 0) {
                    ((currentResume.positionMs * 100) / currentResume.durationMs).toInt().coerceIn(1, 99)
                } else 0
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = if (progress > 0) {
                        getString(R.string.details_continue_episode_progress, currentResume.episode.season, currentResume.episode.episode, progress)
                    } else {
                        getString(R.string.details_continue_episode, currentResume.episode.season, currentResume.episode.episode)
                    }
                    textSize = 12.5f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = Gravity.END
                })
                if (currentResume.durationMs > 0) {
                    panel.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 100
                        this.progress = progress
                        progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
                    }, LinearLayout.LayoutParams(-1, dp(5)).apply {
                        topMargin = dp(6)
                        bottomMargin = dp(10)
                    })
                }
            }

            val actions = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = resources.configuration.layoutDirection
                gravity = Gravity.END
            }
            var primary: Button? = null
            resume?.let { currentResume ->
                val resumeButton = actionButton(getString(R.string.details_resume_episode), true) {
                    launchEpisode(provider, currentResume.episode, currentResume.positionMs)
                }
                primary = resumeButton
                actions.addView(resumeButton, LinearLayout.LayoutParams(dp(142), dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
                actions.addView(actionButton(getString(R.string.details_start_over)) { launchEpisode(provider, currentResume.episode, 0L) },
                    LinearLayout.LayoutParams(dp(112), dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
            }

            val episodes = actionButton(getString(R.string.details_seasons_episodes), primary == null) {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ART, metadata?.backdropUrl ?: stream.backdrop ?: stream.icon)
                })
            }
            if (primary == null) primary = episodes
            actions.addView(episodes, LinearLayout.LayoutParams(dp(160), dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })

            metadata?.trailerUrl?.takeIf(String::isNotBlank)?.let { trailerUrl ->
                actions.addView(actionButton(getString(R.string.details_trailer)) { openExternal(trailerUrl) },
                    LinearLayout.LayoutParams(dp(106), dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
            }

            favoriteButton = actionButton(getString(if (stream.favorite) R.string.details_favorite_on else R.string.details_favorite_off)) {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = getString(if (!current.favorite) R.string.details_favorite_on else R.string.details_favorite_off)
                }
            }
            actions.addView(favoriteButton, LinearLayout.LayoutParams(dp(112), dp(CinemaStyle.ActionHeight)))
            layout.attachActions(actions)

            if (!metadata?.cast.isNullOrEmpty()) {
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = getString(R.string.details_cast)
                    textSize = 16f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(Color.WHITE)
                    gravity = Gravity.END
                    setPadding(0, dp(14), 0, dp(5))
                })
                panel.addView(CastStrip.build(this@SeriesDetailsActivity, metadata?.cast.orEmpty()), LinearLayout.LayoutParams(-1, dp(180)))
            } else {
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = getString(R.string.details_cast_unavailable)
                    textSize = 12f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.END
                    setPadding(0, dp(12), 0, dp(4))
                })
            }

            if (layout.isTv) primary?.requestFocus()
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.episode(provider, episode))
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(provider, episode))
            putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(provider, episode)))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
            putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season)
            putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun openExternal(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addCategory(Intent.CATEGORY_BROWSABLE) })
        }.onFailure {
            Toast.makeText(this, getString(R.string.details_trailer_open_failed), Toast.LENGTH_SHORT).show()
        }
    }

    private fun actionButton(label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        CinemaStyle.styleButton(this, primary)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class Resume(
        val episode: EpisodeEntity,
        val positionMs: Long,
        val durationMs: Long,
        val updatedAt: Long
    )

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
