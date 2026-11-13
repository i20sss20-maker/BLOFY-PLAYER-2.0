package tv.blofy.player.ui.details

import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import tv.blofy.player.ui.common.CinemaStyle
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import tv.blofy.player.core.security.ContentAccessActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.catalog.RelatedSeriesPolicy
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentScreenStyle
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.library.MyLibraryActivity

class SeriesDetailsActivity : ContentAccessActivity() {
    private lateinit var favoriteButton: Button
    private var arabicPresenter: ArabicDetailsPresenter? = null
    private var relatedSeriesJob: Job? = null
    private var lastRelatedKeys: List<String> = emptyList()

    override fun onContentReady(savedInstanceState: Bundle?) {
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
            val provider = try {
                PortalPlaylistClient.ensureSubscriberConnection(
                    applicationContext,
                    BuildConfig.ACTIVATION_BASE_URL,
                    dao,
                    providerId
                )
            } catch (_: Throwable) {
                Toast.makeText(this@SeriesDetailsActivity, "تعذر تحديث اتصال مشترك BLOFY. أعد فتح القائمة.", Toast.LENGTH_LONG).show()
                finish()
                return@launch
            } ?: run { finish(); return@launch }
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
                text = getString(R.string.brand_series)
                textSize = 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.START
                setPadding(0, dp(2), 0, dp(4))
            }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(6) })

            val initialArabic = if (android.os.Build.VERSION.SDK_INT >= 24)
                resources.configuration.locales[0].language == "ar"
            else resources.configuration.locale.language == "ar"
            val title = ContentPresentation.title(
                ArabicDetailsPolicy.preferredTitle(stream.name, metadata?.title, initialArabic),
                stream.kind
            )
            val logo = ImageView(this@SeriesDetailsActivity).apply {
                scaleType = ImageView.ScaleType.FIT_END
                adjustViewBounds = true
                contentDescription = title
                visibility = View.GONE
            }
            panel.addView(logo, layout.logoParams())
            val titleView = TextView(this@SeriesDetailsActivity).apply {
                text = title
                textSize = if (metadata?.logoUrl.isNullOrBlank()) 32f else 18f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(Color.WHITE)
                gravity = Gravity.START
                maxLines = 2
                includeFontPadding = false
                alpha = if (metadata?.logoUrl.isNullOrBlank()) 1f else .9f
            }
            panel.addView(titleView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(7) })
            val originalTitleView = TextView(this@SeriesDetailsActivity).apply {
                textSize = 12.5f
                typeface = BlofyTvDesign.preferredTypeface(this)
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                maxLines = 2
                visibility = View.GONE
            }
            panel.addView(originalTitleView, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(6)
            })

            fun metadataStats(metadata: tv.blofy.player.data.metadata.ProviderMetadata.Metadata?) = buildList {
                    add(getString(R.string.details_series_type))
                    addAll(ContentPresentation.of(stream).badges)
                    (metadata?.releaseDate?.take(4) ?: stream.year)?.takeIf(String::isNotBlank)?.let(::add)
                    if (seasons > 0) add(resources.getQuantityString(R.plurals.details_seasons_count_plural, seasons, seasons))
                    if (allEpisodes.isNotEmpty()) add(resources.getQuantityString(R.plurals.details_episodes_count_plural, allEpisodes.size, allEpisodes.size))
                    metadata?.runtimeMinutes?.takeIf { it > 0 }?.let { add(getString(R.string.details_minutes, it)) }
                    metadata?.rating?.let { add("★ %.1f/10".format(java.util.Locale.US, it)) }
                        ?: stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    val genres = metadata?.genres?.filter(String::isNotBlank).orEmpty().map {
                        tv.blofy.player.ui.catalog.MovieGenres.label(it, initialArabic)
                    }
                    if (genres.isNotEmpty()) add(genres.take(3).joinToString(" / "))
                    else stream.genre?.takeIf(String::isNotBlank)?.let {
                        add(it.split(Regex("[,/|]")).joinToString(" / ") { part ->
                            tv.blofy.player.ui.catalog.MovieGenres.label(part.trim(), initialArabic)
                        })
                    }
                    metadata?.countries?.takeIf { it.isNotEmpty() }?.let { add(getString(R.string.details_country, it.take(2).joinToString(" / "))) }
                    metadata?.originalLanguage?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                }
            val statsView = DetailsMetadataChips.build(this@SeriesDetailsActivity, metadataStats(metadata))
            panel.addView(statsView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = getString(R.string.details_story)
                textSize = 13f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.START
                setPadding(0, 0, 0, dp(3))
            })
            val overviewView = TextView(this@SeriesDetailsActivity).apply {
                tag = "blofy_details_overview"
                textSize = 15f
                typeface = BlofyTvDesign.preferredTypeface(this)
                maxLines = 7
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.START
                setLineSpacing(0f, 1.18f)
                setPadding(0, dp(8), 0, dp(10))
            }
            panel.addView(overviewView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            val presenter = ArabicDetailsPresenter(
                this@SeriesDetailsActivity, stream, titleView, overviewView, originalTitleView
            )
            arabicPresenter = presenter
            panel.addView(presenter.button, LinearLayout.LayoutParams(-2, dp(42)).apply {
                bottomMargin = dp(10)
            })
            val crewView = TextView(this@SeriesDetailsActivity).apply {
                textSize = 11.5f
                typeface = BlofyTvDesign.preferredTypeface(this)
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                setPadding(0, 0, 0, dp(7))
            }
            panel.addView(crewView)

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
                    typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = Gravity.START
                    background = ContentScreenStyle.chip(this@SeriesDetailsActivity)
                    setPadding(dp(10), dp(5), dp(10), dp(5))
                }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(7) })
                if (currentResume.durationMs > 0) {
                    panel.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 100
                        this.progress = progress
                        progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
                        progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0xFF3B2B4B.toInt())
                    }, LinearLayout.LayoutParams(-1, dp(6)).apply {
                        bottomMargin = dp(12)
                    })
                }
            }

            val actions = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = resources.configuration.layoutDirection
                gravity = Gravity.START
            }
            var primary: Button? = null
            resume?.let { currentResume ->
                val resumeButton = actionButton(getString(R.string.details_resume_episode), true) {
                    launchEpisode(provider, currentResume.episode, currentResume.positionMs)
                }
                primary = resumeButton
                actions.addView(resumeButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
                actions.addView(actionButton(getString(R.string.details_start_over)) { launchEpisode(provider, currentResume.episode, 0L) },
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
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
            actions.addView(episodes, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })

            metadata?.trailerUrl?.takeIf(String::isNotBlank)?.let { trailerUrl ->
                actions.addView(actionButton(getString(R.string.details_trailer)) { openExternal(trailerUrl) },
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginStart = dp(8) })
            }

            favoriteButton = actionButton(getString(if (stream.favorite) R.string.details_favorite_on else R.string.details_favorite_off)) {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = getString(if (!current.favorite) R.string.details_favorite_on else R.string.details_favorite_off)
                }
            }
            actions.addView(favoriteButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)))
            layout.attachActions(actions)
            if (BuildConfig.CODE_ONLY_LOGIN) {
                val libraryActions = LinearLayout(this@SeriesDetailsActivity).apply {
                    orientation=LinearLayout.HORIZONTAL
                    layoutDirection=resources.configuration.layoutDirection
                    gravity=Gravity.START
                }
                val watchlist=actionButton(getString(
                    if (ProfileLibraryStore.isWatchlisted(applicationContext,stream.key))
                        R.string.stream_remove_watchlist else R.string.stream_add_watchlist
                )) {}
                watchlist.setOnClickListener {
                    lifecycleScope.launch {
                        val next=withContext(Dispatchers.IO) {
                            val saved=ProfileLibraryStore.isWatchlisted(applicationContext,stream.key)
                            ProfileLibraryStore.setWatchlisted(applicationContext,stream.key,!saved)
                            !saved
                        }
                        watchlist.text=getString(if(next) R.string.stream_remove_watchlist else R.string.stream_add_watchlist)
                    }
                }
                libraryActions.addView(watchlist, LinearLayout.LayoutParams(-2,dp(CinemaStyle.ActionHeight)).apply { marginEnd=dp(9) })
                libraryActions.addView(actionButton(getString(R.string.stream_download_episode)) {
                    startActivity(Intent(this@SeriesDetailsActivity,EpisodesActivity::class.java).apply {
                        putExtra(EpisodesActivity.EXTRA_PROVIDER_ID,providerId)
                        putExtra(EpisodesActivity.EXTRA_SERIES_ID,stream.remoteId)
                        putExtra(EpisodesActivity.EXTRA_SERIES_NAME,stream.name)
                        putExtra(EpisodesActivity.EXTRA_SERIES_ART,metadata?.backdropUrl ?: stream.backdrop ?: stream.icon)
                    })
                }, LinearLayout.LayoutParams(-2,dp(CinemaStyle.ActionHeight)).apply { marginEnd=dp(9) })
                libraryActions.addView(actionButton(getString(R.string.stream_library_title)) {
                    startActivity(Intent(this@SeriesDetailsActivity,MyLibraryActivity::class.java))
                },LinearLayout.LayoutParams(-2,dp(CinemaStyle.ActionHeight)))
                panel.addView(libraryActions,LinearLayout.LayoutParams(-1,-2).apply {bottomMargin=dp(10)})
            }

            val castContainer = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 0, 0, dp(22))
            }
            panel.addView(castContainer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            val relatedContainer = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation=LinearLayout.VERTICAL
                tag="blofy_related_series"
            }
            panel.addView(relatedContainer,LinearLayout.LayoutParams(-1,-2).apply {topMargin=dp(12)})
            showRelatedSeries(dao,provider.id,stream,metadata?.genres.orEmpty(),relatedContainer)
            ProviderDetailsBinding(this@SeriesDetailsActivity, overviewView, crewView,
                castContainer, provider, stream) { updated ->
                    showRelatedSeries(dao,provider.id,stream,updated?.genres.orEmpty(),relatedContainer)
                    DetailsMetadataChips.update(statsView, metadataStats(updated))
                    presenter.render(updated)
                    ArtworkLoader.loadPriority(backdrop, listOf(updated?.backdropUrl, stream.backdrop, stream.icon))
                    ArtworkLoader.loadPriority(poster, listOf(updated?.posterUrl, stream.icon, stream.backdrop))
                    val logoUrl = updated?.logoUrl
                    logo.visibility = if (logoUrl.isNullOrBlank()) View.GONE else View.VISIBLE
                    if (!logoUrl.isNullOrBlank()) ArtworkLoader.load(logo, logoUrl)
                    titleView.textSize = if (logoUrl.isNullOrBlank()) 32f else 18f
                }.start(metadata)

            if (layout.isTv) primary?.requestFocus()
        }
    }

    /** Related series are verified local provider titles only; no LLM guesses. */
    private fun showRelatedSeries(
        dao: tv.blofy.player.data.local.BlofyDao,
        providerId: String,
        current: StreamEntity,
        genres: List<String>,
        container: LinearLayout
    ) {
        relatedSeriesJob?.cancel()
        relatedSeriesJob=lifecycleScope.launch {
            val related=try {
                withContext(Dispatchers.IO) {
                    val categories=dao.categories(providerId,"series").first()
                        .associate { it.remoteId to it.name }
                    val sample=(dao.catalogPageAfterInCategory(
                        providerId,"series",current.categoryId.orEmpty(),0L,140
                    ) + dao.catalogPageAfterAll(providerId,"series",0L,110))
                        .distinctBy { it.key }
                    val cached=ProviderMetadataCache.readGenresForPage(
                        applicationContext,sample.map {it.key})
                    RelatedSeriesPolicy.rank(current,genres,sample,categories,cached,10)
                }
            } catch(cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {emptyList()}
            if(isFinishing||isDestroyed||related.map{it.key}==lastRelatedKeys)return@launch
            lastRelatedKeys=related.map {it.key}
            container.removeAllViews()
            if(related.isEmpty())return@launch
            container.addView(TextView(this@SeriesDetailsActivity).apply {
                text=getString(R.string.stream_details_similar)
                textSize=18f
                setTextColor(Color.WHITE)
                typeface=BlofyTvDesign.preferredTypeface(this,bold=true)
                gravity=Gravity.START
                setPadding(0,dp(12),0,dp(10))
            })
            val row=LinearLayout(this@SeriesDetailsActivity).apply {
                orientation=LinearLayout.HORIZONTAL
            }
            related.forEach { item ->
                val card=LinearLayout(this@SeriesDetailsActivity).apply {
                    orientation=LinearLayout.VERTICAL
                    isFocusable=true
                    isClickable=true
                    contentDescription=item.name
                    setOnClickListener {
                        startActivity(Intent(this@SeriesDetailsActivity,SeriesDetailsActivity::class.java)
                            .putExtra(EXTRA_PROVIDER_ID,providerId)
                            .putExtra(EXTRA_CONTENT_KEY,item.key))
                    }
                }
                BlofyTvDesign.installTvFocus(card)
                val image=ImageView(this@SeriesDetailsActivity).apply {
                    scaleType=ImageView.ScaleType.CENTER_CROP
                    clipToOutline=true
                    contentDescription=item.name
                }
                card.addView(image,LinearLayout.LayoutParams(-1,dp(155)))
                ArtworkLoader.load(image,listOf(item.icon,item.backdrop))
                card.addView(TextView(this@SeriesDetailsActivity).apply {
                    text=ContentPresentation.title(item.name,"series")
                    maxLines=2
                    ellipsize=android.text.TextUtils.TruncateAt.END
                    textSize=12f
                    setTextColor(BlofyTvDesign.TextSecondary)
                    setPadding(dp(3),dp(6),dp(3),0)
                },LinearLayout.LayoutParams(-1,dp(42)))
                row.addView(card,LinearLayout.LayoutParams(dp(118),dp(202)).apply {
                    marginEnd=dp(12)
                })
            }
            container.addView(HorizontalScrollView(this@SeriesDetailsActivity).apply {
                isHorizontalScrollBarEnabled=false
                clipToPadding=false
                addView(row)
            },LinearLayout.LayoutParams(-1,dp(218)))
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
        ContentScreenStyle.styleAction(this, primary)
        minimumWidth = dp(if (primary) 132 else 108)
        setOnClickListener { action() }
    }

    override fun onDestroy() {
        relatedSeriesJob?.cancel()
        arabicPresenter?.close()
        super.onDestroy()
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
