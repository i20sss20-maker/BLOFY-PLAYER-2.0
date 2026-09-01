package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity

class SeriesDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button
    private lateinit var lockButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = FrameLayout(this).apply { background = V339Ui.screenGradient() }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(20), dp(28), dp(26))
            background = V339Ui.screenGradient()
        }
        root.addView(page, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
        }
        top.addView(V339Ui.title(this, "BLOFY  PLAYER", 22f), LinearLayout.LayoutParams(dp(230), dp(60)))
        top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        top.addView(V339Ui.button(this, "رجوع  ←", false).apply { setOnClickListener { finish() } }, LinearLayout.LayoutParams(dp(132), dp(48)))
        page.addView(top, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)))

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val allEpisodes = dao.episodes(providerId, stream.remoteId).first()
            val resume = allEpisodes.mapNotNull { episode ->
                val watch = dao.watchState(episode.key) ?: return@mapNotNull null
                if (watch.completed || watch.positionMs <= 15_000L) null else Resume(episode, watch.positionMs, watch.durationMs, watch.updatedAt)
            }.maxByOrNull { it.updatedAt }
            val seasons = allEpisodes.map { it.season }.distinct().size

            val hero = FrameLayout(this@SeriesDetailsActivity).apply {
                clipToOutline = true
                background = V339Ui.panel(this@SeriesDetailsActivity, V339Ui.PANEL, 18, V339Ui.STROKE)
            }
            val backdrop = ImageView(this@SeriesDetailsActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            ArtworkLoader.load(backdrop, stream.backdrop?.takeIf { it.isNotBlank() } ?: stream.icon)
            hero.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            hero.addView(View(this@SeriesDetailsActivity).apply { background = V339Ui.heroScrim() }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

            val poster = ImageView(this@SeriesDetailsActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                clipToOutline = true
                background = V339Ui.panel(this@SeriesDetailsActivity, V339Ui.PANEL_ALT, 15, V339Ui.PURPLE_LIGHT)
            }
            ArtworkLoader.load(poster, stream.icon)
            hero.addView(poster, FrameLayout.LayoutParams(dp(218), dp(316), Gravity.LEFT or Gravity.CENTER_VERTICAL).apply { leftMargin = dp(24) })

            val info = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setPadding(dp(22), dp(24), dp(18), dp(24))
            }
            info.addView(V339Ui.title(this@SeriesDetailsActivity, "تفاصيل المسلسل", 14f).apply {
                setTextColor(V339Ui.PURPLE_LIGHT); gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(32)))
            info.addView(V339Ui.title(this@SeriesDetailsActivity, stream.name, 36f).apply {
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL; maxLines = 2
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(90)))

            val chips = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_LTR
            }
            listOfNotNull(
                stream.releaseDate?.takeIf { it.isNotBlank() } ?: stream.year?.takeIf { it.isNotBlank() },
                stream.genre?.takeIf { it.isNotBlank() },
                seasons.takeIf { it > 0 }?.let { "$it موسم" },
                allEpisodes.size.takeIf { it > 0 }?.let { "$it حلقة" },
                stream.rating?.takeIf { it.isNotBlank() }?.let { "★ $it" }
            ).forEach { value -> chips.addView(V339Ui.chip(this@SeriesDetailsActivity, value)) }
            info.addView(chips, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))

            info.addView(V339Ui.text(this@SeriesDetailsActivity,
                stream.plot?.takeIf { it.isNotBlank() } ?: "اختر الموسم والحلقة لبدء المشاهدة.",
                15f, Color.rgb(219, 216, 226)).apply {
                gravity = Gravity.RIGHT or Gravity.TOP; maxLines = 5; setLineSpacing(0f, 1.15f)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })

            resume?.let { r ->
                val pct = if (r.durationMs > 0) ((r.positionMs * 100) / r.durationMs).toInt().coerceIn(1, 99) else 0
                info.addView(V339Ui.text(this@SeriesDetailsActivity,
                    "استئناف الموسم ${r.episode.season} • الحلقة ${r.episode.episode}${if (pct > 0) "  •  $pct%" else ""}",
                    13f, V339Ui.PURPLE_LIGHT).apply { gravity = Gravity.RIGHT })
                if (pct > 0) info.addView(ProgressBar(this@SeriesDetailsActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
                    max = 100; progress = pct; progressTintList = V339Ui.progressColors()
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(7)).apply { topMargin = dp(5); bottomMargin = dp(8) })
            }

            val actions = LinearLayout(this@SeriesDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_LTR
            }
            var primary: Button? = null
            resume?.let { r ->
                val resumeButton = V339Ui.button(this@SeriesDetailsActivity, "▶  استئناف الحلقة", true).apply {
                    setOnClickListener { launchEpisode(provider, r.episode, r.positionMs) }
                }
                primary = resumeButton
                actions.addView(resumeButton, LinearLayout.LayoutParams(dp(190), dp(56)))
                actions.addView(V339Ui.button(this@SeriesDetailsActivity, "↺  من البداية", false).apply {
                    setOnClickListener { launchEpisode(provider, r.episode, 0L) }
                }, LinearLayout.LayoutParams(dp(140), dp(56)).apply { leftMargin = dp(8) })
            }
            val episodes = V339Ui.button(this@SeriesDetailsActivity, "المواسم", primary == null).apply {
                setOnClickListener {
                    startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                        putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                        putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                        putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                    })
                }
            }
            if (primary == null) primary = episodes
            actions.addView(episodes, LinearLayout.LayoutParams(dp(135), dp(56)).apply { leftMargin = dp(8) })

            favoriteButton = V339Ui.button(this@SeriesDetailsActivity, if (stream.favorite) "★ المفضلة" else "☆ المفضلة", false).apply {
                setOnClickListener {
                    lifecycleScope.launch {
                        val current = dao.stream(contentKey) ?: return@launch
                        dao.setFavorite(contentKey, !current.favorite)
                        text = if (!current.favorite) "★ المفضلة" else "☆ المفضلة"
                    }
                }
            }
            actions.addView(favoriteButton, LinearLayout.LayoutParams(dp(145), dp(56)).apply { leftMargin = dp(8) })
            lockButton = V339Ui.button(this@SeriesDetailsActivity, if (stream.locked) "🔒 مقفل" else "🔓 قفل", false).apply {
                setOnClickListener {
                    lifecycleScope.launch {
                        val current = dao.stream(contentKey) ?: return@launch
                        if (current.locked) ParentalGate.requirePin(this@SeriesDetailsActivity) { lifecycleScope.launch { dao.setLocked(contentKey, false); lockButton.text = "🔓 قفل" } }
                        else if (!ParentalPinManager.hasPin(this@SeriesDetailsActivity)) ParentalGate.requirePin(this@SeriesDetailsActivity) { lifecycleScope.launch { dao.setLocked(contentKey, true); lockButton.text = "🔒 مقفل" } }
                        else { dao.setLocked(contentKey, true); lockButton.text = "🔒 مقفل" }
                    }
                }
            }
            actions.addView(lockButton, LinearLayout.LayoutParams(dp(120), dp(56)).apply { leftMargin = dp(8) })
            info.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)))

            hero.addView(info, FrameLayout.LayoutParams(dp(820), FrameLayout.LayoutParams.MATCH_PARENT, Gravity.RIGHT).apply { rightMargin = dp(22) })
            page.addView(hero, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            primary?.requestFocus()
        }
    }

    private fun launchEpisode(provider: ProviderEntity, episode: EpisodeEntity, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.episode(provider, episode)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, episode.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "episode"); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(episode)); putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs); putExtra(PlayerActivity.EXTRA_TITLE, episode.title)
            putExtra(PlayerActivity.EXTRA_SERIES_ID, episode.seriesId); putExtra(PlayerActivity.EXTRA_SEASON, episode.season); putExtra(PlayerActivity.EXTRA_EPISODE, episode.episode)
        })
    }

    private fun dp(v: Int) = V339Ui.dp(this, v)
    private data class Resume(val episode: EpisodeEntity, val positionMs: Long, val durationMs: Long, val updatedAt: Long)
    companion object { const val EXTRA_PROVIDER_ID = "provider_id"; const val EXTRA_CONTENT_KEY = "content_key" }
}
