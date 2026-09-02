package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
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
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity

class SeriesDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button
    private val headingTypeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    private val bodyTypeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(66), dp(46), dp(66), dp(46))
            background = AppCompatResources.getDrawable(this@SeriesDetailsActivity, R.drawable.blofy_home_background)
            clipChildren = false
        }
        val poster = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply {
                cornerRadius = dp(24).toFloat()
                setColor(0xFF15111E.toInt())
                setStroke(dp(1), 0x705D3E78)
            }
            clipToOutline = true
            elevation = dp(6).toFloat()
        }
        root.addView(poster, LinearLayout.LayoutParams(dp(324), dp(486)).apply { marginEnd = dp(48) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            clipChildren = false
        }
        root.addView(panel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))
            val allEpisodes = dao.episodes(providerId, stream.remoteId).first()
            val resume = allEpisodes.mapNotNull { episode ->
                val watch = dao.watchState(episode.key) ?: return@mapNotNull null
                if (watch.completed || watch.positionMs <= 15_000L) null else Resume(episode, watch.positionMs, watch.durationMs, watch.updatedAt)
            }.maxByOrNull { it.updatedAt }
            val seasons = allEpisodes.map { it.season }.distinct().size

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                textSize = 42f
                typeface = headingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT
                includeFontPadding = false
                maxLines = 2
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = buildList {
                    add("مسلسل")
                    stream.year?.takeIf(String::isNotBlank)?.let(::add)
                    stream.genre?.takeIf(String::isNotBlank)?.substringBefore(',')?.let(::add)
                    if (seasons > 0) add("$seasons موسم")
                    if (allEpisodes.isNotEmpty()) add("${allEpisodes.size} حلقة")
                    stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                }.joinToString("  •  ")
                textSize = 16f
                typeface = bodyTypeface
                setTextColor(SOFT)
                gravity = Gravity.RIGHT
                setPadding(0, dp(10), 0, dp(20))
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.plot?.takeIf(String::isNotBlank) ?: "اختر الموسم والحلقة لبدء المشاهدة."
                textSize = 17.5f
                typeface = bodyTypeface
                maxLines = 5
                setTextColor(0xFFE3DEE8.toInt())
                gravity = Gravity.RIGHT
                setLineSpacing(dp(2).toFloat(), 1.15f)
                setPadding(0, 0, 0, dp(26))
            })

            resume?.let { r ->
                val pct = if (r.durationMs > 0) ((r.positionMs * 100) / r.durationMs).toInt().coerceIn(1, 99) else 0
                panel.addView(TextView(this@SeriesDetailsActivity).apply {
                    text = "استئناف الموسم ${r.episode.season}  •  الحلقة ${r.episode.episode}${if (pct > 0) "  •  $pct%" else ""}"
                    textSize = 15f
                    typeface = bodyTypeface
                    setTextColor(SOFT)
                    gravity = Gravity.RIGHT
                })
                if (r.durationMs > 0) panel.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                    max = 100
                    progress = pct
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8)).apply {
                    topMargin = dp(9)
                    bottomMargin = dp(20)
                })
            }

            val row = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.RIGHT
                clipChildren = false
            }
            var primary: Button? = null
            resume?.let { r ->
                val resumeButton = actionButton("▶  استئناف الحلقة") { launchEpisode(provider, r.episode, r.positionMs) }
                primary = resumeButton
                row.addView(resumeButton, LinearLayout.LayoutParams(dp(240), dp(72)).apply { marginStart = dp(12) })
                row.addView(actionButton("من البداية") { launchEpisode(provider, r.episode, 0L) }, LinearLayout.LayoutParams(dp(185), dp(72)).apply { marginStart = dp(12) })
            }
            val episodes = actionButton("المواسم والحلقات") {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                })
            }
            if (primary == null) primary = episodes
            row.addView(episodes, LinearLayout.LayoutParams(dp(240), dp(72)).apply { marginStart = dp(12) })

            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(185), dp(72)).apply { marginStart = dp(12) })
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

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15.5f
        typeface = bodyTypeface
        isFocusable = true
        includeFontPadding = false
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.04f else 1f)
                .scaleY(if (focused) 1.04f else 1f)
                .translationZ(if (focused) 18f else 2f)
                .setDuration(if (focused) 115L else 90L)
                .start()
        }
        setOnClickListener { action() }
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF8342CF.toInt(), 0xFF5D269F.toInt()) else intArrayOf(0xE61B1428.toInt(), 0xED100B19.toInt())
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFE8CEFF.toInt() else 0x66533A69)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private data class Resume(val episode: EpisodeEntity, val positionMs: Long, val durationMs: Long, val updatedAt: Long)

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
        private val SOFT = Color.rgb(208, 174, 235)
    }
}
