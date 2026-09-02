package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
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
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(54), dp(38), dp(54), dp(38))
            background = AppCompatResources.getDrawable(this@SeriesDetailsActivity, R.drawable.blofy_home_background)
        }
        val posterCard = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(9), dp(9), dp(9), dp(9))
            background = cardBackground()
            elevation = dp(8).toFloat()
        }
        val poster = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF16101F.toInt())
        }
        posterCard.addView(poster, LinearLayout.LayoutParams(dp(300), dp(450)))
        root.addView(posterCard, LinearLayout.LayoutParams(dp(320), dp(470)).apply { marginEnd = dp(42) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        root.addView(panel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            ArtworkLoader.load(poster, stream.icon)
            val allEpisodes = dao.episodes(providerId, stream.remoteId).first()
            val resume = allEpisodes.mapNotNull { episode ->
                val watch = dao.watchState(episode.key) ?: return@mapNotNull null
                if (watch.completed || watch.positionMs <= 15_000L) null else Resume(episode, watch.positionMs, watch.durationMs, watch.updatedAt)
            }.maxByOrNull { it.updatedAt }
            val seasons = allEpisodes.map { it.season }.distinct().size

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "BLOFY SERIES"
                textSize = 12f
                letterSpacing = .11f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.RIGHT
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                textSize = 40f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT
                includeFontPadding = false
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = buildList {
                    add("مسلسل")
                    stream.year?.takeIf(String::isNotBlank)?.let(::add)
                    stream.genre?.takeIf(String::isNotBlank)?.let(::add)
                    if (seasons > 0) add("$seasons موسم")
                    if (allEpisodes.isNotEmpty()) add("${allEpisodes.size} حلقة")
                    stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                }.joinToString("  •  ")
                textSize = 15.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.RIGHT
                setPadding(0, dp(8), 0, dp(18))
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.plot?.takeIf(String::isNotBlank) ?: "اختر الموسم والحلقة لبدء المشاهدة."
                textSize = 17f
                typeface = BlofyTvDesign.BodyTypeface
                maxLines = 5
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.RIGHT
                setLineSpacing(0f, 1.2f)
                setPadding(0, 0, 0, dp(24))
            })

            resume?.let { r ->
                val pct = if (r.durationMs > 0) ((r.positionMs * 100) / r.durationMs).toInt().coerceIn(1, 99) else 0
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = "متابعة الموسم ${r.episode.season} • الحلقة ${r.episode.episode}${if (pct > 0) "  •  $pct%" else ""}"
                    textSize = 14.5f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = Gravity.RIGHT
                })
                if (r.durationMs > 0) panel.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                    max = 100; progress = pct
                    progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(7)).apply { topMargin = dp(8); bottomMargin = dp(18) })
            }

            val row = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.RIGHT
            }
            var primary: Button? = null
            resume?.let { r ->
                val resumeButton = actionButton("▶  استئناف الحلقة", true) { launchEpisode(provider, r.episode, r.positionMs) }
                primary = resumeButton
                row.addView(resumeButton, LinearLayout.LayoutParams(dp(230), dp(70)).apply { marginStart = dp(10) })
                row.addView(actionButton("↺  من البداية") { launchEpisode(provider, r.episode, 0L) }, LinearLayout.LayoutParams(dp(180), dp(70)).apply { marginStart = dp(10) })
            }
            val episodes = actionButton("▤  المواسم والحلقات", primary == null) {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ART, stream.icon ?: stream.backdrop)
                })
            }
            if (primary == null) primary = episodes
            row.addView(episodes, LinearLayout.LayoutParams(dp(240), dp(70)).apply { marginStart = dp(10) })

            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(180), dp(70)).apply { marginStart = dp(10) })
            panel.addView(row)
            primary?.requestFocus()
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.episode(provider, episode))
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode))
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
            putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId)
            putExtra(PlayerActivity.EXTRA_SEASON, episode.season)
            putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun actionButton(label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = BlofyTvDesign.BodyTypeface
        isFocusable = true
        setTextColor(Color.WHITE)
        background = buttonBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused, primary)
            view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).translationZ(if (focused) dp(10).toFloat() else dp(2).toFloat()).setDuration(85).start()
        }
        setOnClickListener { action() }
    }

    private fun cardBackground() = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF2B203B.toInt(), 0xFF17111F.toInt())).apply {
        cornerRadius = dp(24).toFloat(); setStroke(dp(1), 0xFF58416F.toInt())
    }

    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt())
            primary -> intArrayOf(0xFF843FE6.toInt(), 0xFF5720AD.toInt())
            focused -> intArrayOf(0xFF633A8D.toInt(), 0xFF35214C.toInt())
            else -> intArrayOf(0xFF2B203B.toInt(), 0xFF1A1325.toInt())
        }
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0xFF513C67.toInt())
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private data class Resume(val episode: EpisodeEntity, val positionMs: Long, val durationMs: Long, val updatedAt: Long)

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
