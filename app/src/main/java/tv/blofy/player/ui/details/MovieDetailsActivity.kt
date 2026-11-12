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
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.MovieGenres
import tv.blofy.player.ui.catalog.SimilarMoviePolicy
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentScreenStyle
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : ContentAccessActivity() {
    private lateinit var favoriteButton: Button
    private var arabicPresenter: ArabicDetailsPresenter? = null
    private var similarMoviesJob: Job? = null
    private var lastSimilarKeys: List<String> = emptyList()

    override fun onContentReady(savedInstanceState: Bundle?) {
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) {
            finish()
            return
        }

        val uiDirection = resources.configuration.layoutDirection
        val contentGravity = Gravity.START
        val layout = DetailsLayout(this)
        val backdrop = layout.backdrop
        val poster = layout.poster

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
                Toast.makeText(this@MovieDetailsActivity, "تعذر تحديث اتصال مشترك BLOFY. أعد فتح القائمة.", Toast.LENGTH_LONG).show()
                finish()
                return@launch
            } ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)
            val metadata = withContext(Dispatchers.IO) {
                XtreamMetadataFallback.movie(provider, stream)
            }

            ArtworkLoader.loadPriority(backdrop, listOf(metadata?.backdropUrl, stream.backdrop, stream.icon))

            ArtworkLoader.loadPriority(poster, listOf(metadata?.posterUrl, stream.icon, stream.backdrop))
            val info = layout.info

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = getString(R.string.brand_cinema)
                textSize = 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = contentGravity
                setPadding(0, dp(2), 0, dp(4))
            }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(6) })

            val initialArabic = if (android.os.Build.VERSION.SDK_INT >= 24)
                resources.configuration.locales[0].language == "ar"
            else resources.configuration.locale.language == "ar"
            val title = ContentPresentation.title(
                ArabicDetailsPolicy.preferredTitle(stream.name, metadata?.title, initialArabic),
                stream.kind
            )
            val logo = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.FIT_END
                adjustViewBounds = true
                contentDescription = title
                visibility = View.GONE
            }
            info.addView(logo, layout.logoParams())
            val titleView = TextView(this@MovieDetailsActivity).apply {
                text = title
                textSize = if (metadata?.logoUrl.isNullOrBlank()) 32f else 18f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(Color.WHITE)
                gravity = contentGravity
                maxLines = 2
                includeFontPadding = false
                alpha = if (metadata?.logoUrl.isNullOrBlank()) 1f else .9f
            }
            info.addView(titleView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(7) })
            val originalTitleView = TextView(this@MovieDetailsActivity).apply {
                textSize = 12.5f
                typeface = BlofyTvDesign.preferredTypeface(this)
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                maxLines = 2
                visibility = View.GONE
            }
            info.addView(originalTitleView, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(6)
            })

            fun metadataStats(metadata: tv.blofy.player.data.metadata.ProviderMetadata.Metadata?) = buildList {
                    add(getString(R.string.details_movie_type))
                    addAll(ContentPresentation.of(stream).badges)
                    (metadata?.releaseDate?.take(4) ?: stream.year)?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.runtimeMinutes?.takeIf { it > 0 }?.let { add(getString(R.string.details_minutes, it)) }
                        ?: stream.duration?.takeIf(String::isNotBlank)?.let(::add)
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
                    stream.extension?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                }
            val statsView = DetailsMetadataChips.build(this@MovieDetailsActivity, metadataStats(metadata))
            info.addView(statsView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = getString(R.string.details_story)
                textSize = 13f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = contentGravity
                setPadding(0, 0, 0, dp(3))
            })
            val overviewView = TextView(this@MovieDetailsActivity).apply {
                tag = "blofy_details_overview"
                text = metadata?.overview?.takeIf(String::isNotBlank)
                    ?: stream.plot?.takeIf(String::isNotBlank)
                    ?: getString(R.string.details_movie_no_description)
                textSize = 15f
                typeface = BlofyTvDesign.preferredTypeface(this)
                maxLines = 7
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = contentGravity
                setLineSpacing(0f, 1.18f)
                setPadding(0, dp(8), 0, dp(10))
            }
            info.addView(overviewView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            val presenter = ArabicDetailsPresenter(
                this@MovieDetailsActivity, stream, titleView, overviewView, originalTitleView
            )
            arabicPresenter = presenter
            info.addView(presenter.button, LinearLayout.LayoutParams(-2, dp(42)).apply {
                bottomMargin = dp(10)
            })

            val crewView = TextView(this@MovieDetailsActivity).apply {
                textSize = 11.5f
                typeface = BlofyTvDesign.preferredTypeface(this)
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = contentGravity
                setPadding(0, 0, 0, dp(8))
            }
            info.addView(crewView)


            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val progress = ((resumeMs * 100L) / durationMs).coerceIn(1, 99).toInt()
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = getString(R.string.details_continue_watching, progress)
                    textSize = 12.5f
                    typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = contentGravity
                    background = ContentScreenStyle.chip(this@MovieDetailsActivity)
                    setPadding(dp(10), dp(5), dp(10), dp(5))
                }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(7) })
                info.addView(ProgressBar(this@MovieDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                    max = 100
                    this.progress = progress
                    progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
                    progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0xFF3B2B4B.toInt())
                }, LinearLayout.LayoutParams(-1, dp(6)).apply { bottomMargin = dp(12) })
            }

            val actions = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = uiDirection
                gravity = contentGravity
            }
            val play = actionButton(getString(if (resumeMs > 30_000L) R.string.details_resume else R.string.details_watch_now), true) {
                openPlayer(provider, stream, url, resumeMs)
            }
            actions.addView(play, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
            if (resumeMs > 30_000L) {
                actions.addView(actionButton(getString(R.string.details_start_over)) { openPlayer(provider, stream, url, 0L) },
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
            }
            metadata?.trailerUrl?.takeIf(String::isNotBlank)?.let { trailerUrl ->
                actions.addView(actionButton(getString(R.string.details_trailer)) { openExternal(trailerUrl) },
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
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

            val castContainer = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 0, 0, dp(22))
            }
            info.addView(castContainer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            val similarContainer = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                tag = "blofy_similar_movies"
            }
            info.addView(similarContainer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
            showSimilarMovies(dao, provider.id, stream, metadata?.genres.orEmpty(), similarContainer)
            ProviderDetailsBinding(this@MovieDetailsActivity, overviewView, crewView,
                castContainer, provider, stream) { updated ->
                    showSimilarMovies(dao, provider.id, stream, updated?.genres.orEmpty(), similarContainer)
                    DetailsMetadataChips.update(statsView, metadataStats(updated))
                    presenter.render(updated)
                    ArtworkLoader.loadPriority(backdrop, listOf(updated?.backdropUrl, stream.backdrop, stream.icon))
                    ArtworkLoader.loadPriority(poster, listOf(updated?.posterUrl, stream.icon, stream.backdrop))
                    val logoUrl = updated?.logoUrl
                    logo.visibility = if (logoUrl.isNullOrBlank()) View.GONE else View.VISIBLE
                    if (!logoUrl.isNullOrBlank()) ArtworkLoader.load(logo, logoUrl)
                    titleView.textSize = if (logoUrl.isNullOrBlank()) 32f else 18f
                }.start(metadata)

            if (layout.isTv) play.requestFocus()
        }
    }

    /**
     * Fetch at most two local, bounded genre pages. Nothing is downloaded from
     * the provider to populate the recommendations, and missing genre metadata
     * never delays Details or playback. Never show fabricated similar titles.
     */
    private fun showSimilarMovies(
        dao: tv.blofy.player.data.local.BlofyDao,
        providerId: String,
        film: StreamEntity,
        detailGenres: List<String>,
        container: LinearLayout
    ) {
        similarMoviesJob?.cancel()
        similarMoviesJob = lifecycleScope.launch {
            val result = try {
                withContext(Dispatchers.IO) {
                    val categoryNames = dao.categories(providerId, "movie").first()
                        .associate { it.remoteId to it.name }
                    val genres = SimilarMoviePolicy.genreKeys(film, detailGenres, categoryNames[film.categoryId])
                    if (genres.isEmpty()) return@withContext emptyList<StreamEntity>()
                    val explicitGenreMatches = genres.take(2).flatMap { key ->
                        dao.catalogPageForMovieGenre(
                            MovieGenres.catalogQuery(providerId, null, key, limit = 64)
                        )
                    }
                    // Many Xtream list endpoints omit genre even when detail
                    // metadata was previously cached. Check one small source
                    // page locally as fallback, never the full 24k+ catalog.
                    val fallbackPage = if (explicitGenreMatches.size < 10)
                        dao.catalogPageAfterAll(providerId, "movie", 0L, 96)
                    else emptyList()
                    val related = (explicitGenreMatches + fallbackPage).distinctBy { it.key }
                    val detailCache = ProviderMetadataCache.readGenresForPage(
                        applicationContext, related.map { it.key })
                    SimilarMoviePolicy.rank(
                        film, detailGenres, related, categoryNames, 10, cachedGenres = detailCache
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                emptyList()
            }
            if (isFinishing || isDestroyed || result.map { it.key } == lastSimilarKeys) return@launch
            lastSimilarKeys = result.map { it.key }
            container.removeAllViews()
            if (result.isEmpty()) return@launch
            container.addView(TextView(this@MovieDetailsActivity).apply {
                text = getString(R.string.stream_details_similar)
                textSize = 18f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                setTextColor(Color.WHITE)
                gravity = Gravity.START
                setPadding(0, dp(12), 0, dp(10))
            })
            val row = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(3), 0, dp(3), dp(9))
            }
            result.forEach { similar ->
                val card = LinearLayout(this@MovieDetailsActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    isFocusable = true
                    isClickable = true
                    contentDescription = similar.name
                    setOnClickListener {
                        startActivity(Intent(this@MovieDetailsActivity, MovieDetailsActivity::class.java).apply {
                            putExtra(EXTRA_PROVIDER_ID, providerId)
                            putExtra(EXTRA_CONTENT_KEY, similar.key)
                        })
                    }
                }
                BlofyTvDesign.installTvFocus(card)
                val cover = ImageView(this@MovieDetailsActivity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    contentDescription = similar.name
                    clipToOutline = true
                }
                card.addView(cover, LinearLayout.LayoutParams(-1, dp(155)))
                ArtworkLoader.load(cover, listOf(similar.icon, similar.backdrop))
                card.addView(TextView(this@MovieDetailsActivity).apply {
                    text = similar.name
                    maxLines = 2
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    textSize = 12f
                    setTextColor(BlofyTvDesign.TextSecondary)
                    setPadding(dp(3), dp(6), dp(3), 0)
                }, LinearLayout.LayoutParams(-1, dp(42)))
                row.addView(card, LinearLayout.LayoutParams(dp(118), dp(202)).apply {
                    marginEnd = dp(12)
                })
            }
            container.addView(HorizontalScrollView(this@MovieDetailsActivity).apply {
                isHorizontalScrollBarEnabled = false
                clipToPadding = false
                addView(row)
            }, LinearLayout.LayoutParams(-1, dp(218)))
        }
    }

    private fun openPlayer(provider: ProviderEntity, stream: StreamEntity, url: String, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "movie")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(provider, stream))
            putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream)))
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
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
        minimumWidth = dp(if (primary) 126 else 108)
        setOnClickListener { action() }
    }

    override fun onDestroy() {
        similarMoviesJob?.cancel()
        arabicPresenter?.close()
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
