package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
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

        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@SeriesDetailsActivity, R.drawable.blofy_home_background)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
        }
        val backdrop = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.22f
            setBackgroundColor(BlofyTvDesign.Background)
        }
        root.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0x26FFFFFF, 0xB8FFFFFF.toInt(), 0xF2F7F5FA.toInt(), 0xFFF5F5F8.toInt())
            )
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(58), dp(34), dp(58), dp(34))
            clipChildren = false
        }
        root.addView(body, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
            setPadding(dp(8), 0, dp(8), 0)
        }
        body.addView(panel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(26) })

        val posterCard = FrameLayout(this).apply {
            background = BlofyTvDesign.elevatedSurface(dp(24).toFloat())
            elevation = dp(8).toFloat()
            clipToOutline = true
        }
        val poster = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
        }
        posterCard.addView(poster, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply {
            setMargins(dp(8), dp(8), dp(8), dp(8))
        })
        body.addView(posterCard, LinearLayout.LayoutParams(dp(264), dp(396)).apply { marginStart = dp(20) })
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            ArtworkLoader.load(backdrop, listOf(stream.backdrop, stream.icon))
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))

            val allEpisodes = dao.episodes(providerId, stream.remoteId).first()
            val resume = allEpisodes.mapNotNull { episode ->
                val watch = dao.watchState(episode.key) ?: return@mapNotNull null
                if (watch.completed || watch.positionMs <= 15_000L) null else Resume(episode, watch.positionMs, watch.durationMs, watch.updatedAt)
            }.maxByOrNull { it.updatedAt }
            val seasons = allEpisodes.map { it.season }.distinct().size

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "BLOFY  •  مسلسل"
                BlofyTvDesign.applyCaption(this)
                setTextColor(BlofyTvDesign.Mint)
                gravity = Gravity.RIGHT
                background = BlofyTvDesign.badge(dp(14).toFloat())
                setPadding(dp(13), dp(6), dp(13), dp(6))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                BlofyTvDesign.applyHeroTitle(this)
                textSize = 43f
                gravity = Gravity.RIGHT
                maxLines = 2
            })

            val metaRow = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }
            metaRow.addView(TextView(this@SeriesDetailsActivity).apply {
                text = buildList {
                    stream.year?.takeIf(String::isNotBlank)?.let(::add)
                    stream.genre?.takeIf(String::isNotBlank)?.substringBefore(',')?.let(::add)
                    if (seasons > 0) add("$seasons موسم")
                    if (allEpisodes.isNotEmpty()) add("${allEpisodes.size} حلقة")
                }.joinToString("  •  ")
                BlofyTvDesign.applyBody(this)
                textSize = 15.5f
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(0, dp(44), 1f))
            stream.rating?.takeIf { it.isNotBlank() }?.let { rating ->
                metaRow.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = "★  $rating"
                    BlofyTvDesign.applyLabel(this)
                    setTextColor(BlofyTvDesign.PurpleDeep)
                    gravity = Gravity.CENTER
                    background = BlofyTvDesign.badge(dp(14).toFloat())
                    setPadding(dp(13), dp(7), dp(13), dp(7))
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) })
            }
            panel.addView(metaRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(4); bottomMargin = dp(10) })

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.plot?.takeIf(String::isNotBlank) ?: "اختر الموسم والحلقة لبدء المشاهدة."
                BlofyTvDesign.applyBody(this)
                textSize = 16.5f
                maxLines = 4
                gravity = Gravity.RIGHT
                setLineSpacing(dp(2).toFloat(), 1.14f)
                setPadding(0, 0, 0, dp(16))
            })

            resume?.let { r ->
                val pct = if (r.durationMs > 0) ((r.positionMs * 100) / r.durationMs).toInt().coerceIn(1, 99) else 0
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = "◷  تتابع الآن  •  الموسم ${r.episode.season}  •  الحلقة ${r.episode.episode}${if (pct > 0) "  •  $pct%" else ""}"
                    BlofyTvDesign.applyCaption(this)
                    setTextColor(BlofyTvDesign.TextSecondary)
                    gravity = Gravity.RIGHT
                    setPadding(dp(13), dp(8), dp(13), dp(8))
                    background = BlofyTvDesign.badge(dp(14).toFloat())
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                if (r.durationMs > 0) panel.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                    max = 100; progress = pct
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(6)).apply { topMargin = dp(8); bottomMargin = dp(14) })
            }

            val row = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                clipChildren = false
            }
            var primary: Button? = null
            resume?.let { r ->
                val resumeButton = actionButton("▶  استئناف الحلقة", primary = true) { launchEpisode(provider, r.episode, r.positionMs) }
                primary = resumeButton
                row.addView(resumeButton, LinearLayout.LayoutParams(dp(214), dp(60)).apply { marginStart = dp(9) })
                row.addView(actionButton("↺  من البداية") { launchEpisode(provider, r.episode, 0L) }, LinearLayout.LayoutParams(dp(162), dp(60)).apply { marginStart = dp(9) })
            }
            val episodes = actionButton("▤  المواسم والحلقات", primary = resume == null) {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                })
            }
            if (primary == null) primary = episodes
            row.addView(episodes, LinearLayout.LayoutParams(dp(218), dp(60)).apply { marginStart = dp(9) })

            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(160), dp(60)).apply { marginStart = dp(9) })
            panel.addView(row)
            primary?.post { primary?.requestFocus() }
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
        textSize = 14.5f
        typeface = BlofyTvDesign.BodyTypeface
        includeFontPadding = false
        setTextColor(if (primary) Color.WHITE else BlofyTvDesign.TextPrimary)
        BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.04f, primary)
        setOnClickListener { action() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private data class Resume(val episode: EpisodeEntity, val positionMs: Long, val durationMs: Long, val updatedAt: Long)

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
