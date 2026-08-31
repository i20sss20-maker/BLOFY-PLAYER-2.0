package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
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

        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(5, 5, 10)) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(76, 56, 76, 56)
        }
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val resume = dao.episodes(providerId, stream.remoteId).first()
                .mapNotNull { episode ->
                    val watch = dao.watchState(episode.key) ?: return@mapNotNull null
                    if (watch.completed || watch.positionMs <= 15_000L) null else Triple(episode, watch.positionMs, watch.updatedAt)
                }
                .maxByOrNull { it.third }

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                textSize = 36f
                setTextColor(Color.WHITE)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = buildList {
                    add("مسلسل")
                    stream.year?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.genre?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.duration?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.rating?.takeIf { it.isNotBlank() }?.let { add("★ $it") }
                    resume?.let { add("لديك حلقة غير مكتملة") }
                }.joinToString("  •  ")
                textSize = 16f
                setTextColor(Color.rgb(190, 165, 225))
                setPadding(0, 8, 0, 22)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "اختر الموسم والحلقة لبدء التشغيل."
                textSize = 17f
                maxLines = 5
                setTextColor(Color.rgb(220, 220, 225))
                setPadding(0, 0, 0, 30)
            })

            val row = LinearLayout(this@SeriesDetailsActivity).apply { orientation = LinearLayout.HORIZONTAL }
            var primary: Button? = null
            resume?.let { (episode, positionMs, _) ->
                val resumeButton = actionButton("استئناف S${episode.season} E${episode.episode}") {
                    launchEpisode(provider, episode, positionMs)
                }
                primary = resumeButton
                row.addView(resumeButton, LinearLayout.LayoutParams(250, 82).apply { marginEnd = 12 })
                row.addView(actionButton("من البداية") {
                    launchEpisode(provider, episode, 0L)
                }, LinearLayout.LayoutParams(190, 82).apply { marginEnd = 12 })
            }

            val episodes = actionButton("الحلقات") {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                })
            }
            if (primary == null) primary = episodes
            row.addView(episodes, LinearLayout.LayoutParams(200, 82).apply { marginEnd = 12 })

            favoriteButton = actionButton(if (stream.favorite) "★ المفضلة" else "☆ المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★ المفضلة" else "☆ المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(200, 82).apply { marginEnd = 12 })

            lockButton = actionButton(if (stream.locked) "🔒 مقفل" else "🔓 قفل") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    if (current.locked) {
                        ParentalGate.requirePin(this@SeriesDetailsActivity) {
                            lifecycleScope.launch {
                                dao.setLocked(contentKey, false)
                                lockButton.text = "🔓 قفل"
                            }
                        }
                    } else {
                        if (!ParentalPinManager.hasPin(this@SeriesDetailsActivity)) {
                            ParentalGate.requirePin(this@SeriesDetailsActivity) {
                                lifecycleScope.launch {
                                    dao.setLocked(contentKey, true)
                                    lockButton.text = "🔒 مقفل"
                                }
                            }
                        } else {
                            dao.setLocked(contentKey, true)
                            lockButton.text = "🔒 مقفل"
                        }
                    }
                }
            }
            row.addView(lockButton, LinearLayout.LayoutParams(180, 82))
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
        textSize = 16f
        isFocusable = true
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view: View, focused: Boolean ->
            view.background = buttonBackground(focused)
            view.animate().scaleX(if (focused) 1.04f else 1f).scaleY(if (focused) 1.04f else 1f).setDuration(100).start()
        }
        setOnClickListener { action() }
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 18f
        setColor(if (focused) Color.rgb(76, 35, 128) else Color.rgb(28, 21, 42))
        setStroke(if (focused) 3 else 1, if (focused) Color.rgb(190, 135, 255) else Color.rgb(64, 48, 84))
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
