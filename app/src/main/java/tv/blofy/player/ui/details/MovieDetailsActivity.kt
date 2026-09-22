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
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import tv.blofy.player.core.security.ContentAccessActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.XtreamMetadataFallback
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : ContentAccessActivity() {
    private lateinit var favoriteButton: Button

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
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
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
                text = "BLOFY CINEMA"
                textSize = 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = contentGravity
                background = BlofyTvDesign.badge(dp(10).toFloat())
                setPadding(dp(10), dp(4), dp(10), dp(4))
            }, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(6) })

            val title = ContentPresentation.title(metadata?.title?.takeIf(String::isNotBlank) ?: stream.name, stream.kind)
            val logo = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.FIT_END
                adjustViewBounds = true
                contentDescription = title
                visibility = View.GONE
            }
            info.addView(logo, layout.logoParams())
            val titleView = TextView(this@MovieDetailsActivity).apply {
                text = title
                textSize = if (metadata?.logoUrl.isNullOrBlank()) 28f else 18f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(Color.WHITE)
                gravity = contentGravity
                maxLines = 2
                includeFontPadding = false
                alpha = if (metadata?.logoUrl.isNullOrBlank()) 1f else .9f
            }
            info.addView(titleView)

            fun metadataStats(metadata: tv.blofy.player.data.metadata.ProviderMetadata.Metadata?) = buildList {
                    add(getString(R.string.details_movie_type))
                    addAll(ContentPresentation.of(stream).badges)
                    (metadata?.releaseDate?.take(4) ?: stream.year)?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.runtimeMinutes?.takeIf { it > 0 }?.let { add(getString(R.string.details_minutes, it)) }
                        ?: stream.duration?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.rating?.let { add("★ %.1f/10".format(java.util.Locale.US, it)) }
                        ?: stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    val genres = metadata?.genres?.filter(String::isNotBlank).orEmpty()
                    if (genres.isNotEmpty()) add(genres.take(3).joinToString(" / "))
                    else stream.genre?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.countries?.takeIf { it.isNotEmpty() }?.let { add(it.take(2).joinToString(" / ")) }
                    metadata?.originalLanguage?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                    stream.extension?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                }.joinToString("   •   ")
            val statsView = TextView(this@MovieDetailsActivity).apply {
                tag = "blofy_details_stats"
                text = metadataStats(metadata)
                textSize = 13.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.Lavender)
                gravity = contentGravity
                maxLines = 2
                background = BlofyTvDesign.badge(dp(12).toFloat())
                setPadding(dp(12), dp(8), dp(12), dp(8))
            }
            info.addView(statsView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = getString(R.string.details_story)
                textSize = 13f
                typeface = BlofyTvDesign.HeadingTypeface
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
                typeface = BlofyTvDesign.BodyTypeface
                maxLines = 7
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = contentGravity
                setLineSpacing(0f, 1.18f)
                background = BlofyTvDesign.glassSurface(dp(14).toFloat(), false)
                setPadding(dp(14), dp(12), dp(14), dp(12))
            }
            info.addView(overviewView, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })

            val crewView = TextView(this@MovieDetailsActivity).apply {
                textSize = 11.5f
                typeface = BlofyTvDesign.MediumTypeface
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
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = contentGravity
                    background = BlofyTvDesign.badge(dp(10).toFloat())
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
            actions.addView(play, LinearLayout.LayoutParams(dp(126), dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
            if (resumeMs > 30_000L) {
                actions.addView(actionButton(getString(R.string.details_start_over)) { openPlayer(provider, stream, url, 0L) },
                    LinearLayout.LayoutParams(dp(112), dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
            }
            metadata?.trailerUrl?.takeIf(String::isNotBlank)?.let { trailerUrl ->
                actions.addView(actionButton(getString(R.string.details_trailer)) { openExternal(trailerUrl) },
                    LinearLayout.LayoutParams(dp(106), dp(CinemaStyle.ActionHeight)).apply { marginEnd = dp(8) })
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

            val castContainer = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
            }
            info.addView(castContainer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
            ProviderDetailsBinding(this@MovieDetailsActivity, overviewView, crewView,
                castContainer, provider, stream) { updated ->
                    statsView.text = metadataStats(updated)
                    titleView.text = ContentPresentation.title(updated?.title?.takeIf(String::isNotBlank) ?: stream.name, stream.kind)
                    ArtworkLoader.loadPriority(backdrop, listOf(updated?.backdropUrl, stream.backdrop, stream.icon))
                    ArtworkLoader.loadPriority(poster, listOf(updated?.posterUrl, stream.icon, stream.backdrop))
                    val logoUrl = updated?.logoUrl
                    logo.visibility = if (logoUrl.isNullOrBlank()) View.GONE else View.VISIBLE
                    if (!logoUrl.isNullOrBlank()) ArtworkLoader.load(logo, logoUrl)
                    titleView.textSize = if (logoUrl.isNullOrBlank()) 28f else 18f
                }.start(metadata)

            if (layout.isTv) play.requestFocus()
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
        CinemaStyle.styleButton(this, primary)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
