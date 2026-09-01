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
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.V339Ui
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
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
        val back = V339Ui.button(this, "رجوع  ←", false).apply { setOnClickListener { finish() } }
        top.addView(back, LinearLayout.LayoutParams(dp(132), dp(48)))
        page.addView(top, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)))

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)
            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L

            val hero = FrameLayout(this@MovieDetailsActivity).apply {
                clipToOutline = true
                background = V339Ui.panel(this@MovieDetailsActivity, V339Ui.PANEL, 18, V339Ui.STROKE)
            }
            val backdrop = ImageView(this@MovieDetailsActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            ArtworkLoader.load(backdrop, stream.backdrop?.takeIf { it.isNotBlank() } ?: stream.icon)
            hero.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            hero.addView(View(this@MovieDetailsActivity).apply { background = V339Ui.heroScrim() }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

            val poster = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                clipToOutline = true
                background = V339Ui.panel(this@MovieDetailsActivity, V339Ui.PANEL_ALT, 15, V339Ui.PURPLE_LIGHT)
            }
            ArtworkLoader.load(poster, stream.icon)
            hero.addView(poster, FrameLayout.LayoutParams(dp(218), dp(316), Gravity.LEFT or Gravity.CENTER_VERTICAL).apply { leftMargin = dp(24) })

            val info = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setPadding(dp(22), dp(24), dp(18), dp(24))
            }
            info.addView(V339Ui.title(this@MovieDetailsActivity, "تفاصيل الفيلم", 14f).apply {
                setTextColor(V339Ui.PURPLE_LIGHT); gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(32)))
            info.addView(V339Ui.title(this@MovieDetailsActivity, stream.name, 36f).apply {
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL; maxLines = 2
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(90)))

            val chips = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_LTR
            }
            listOfNotNull(
                stream.releaseDate?.takeIf { it.isNotBlank() } ?: stream.year?.takeIf { it.isNotBlank() },
                stream.genre?.takeIf { it.isNotBlank() },
                stream.duration?.takeIf { it.isNotBlank() },
                stream.rating?.takeIf { it.isNotBlank() }?.let { "★ $it" }
            ).forEach { value -> chips.addView(V339Ui.chip(this@MovieDetailsActivity, value)) }
            info.addView(chips, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))

            info.addView(V339Ui.text(this@MovieDetailsActivity,
                stream.plot?.takeIf { it.isNotBlank() } ?: "استمتع بالمشاهدة على BLOFY PLAYER",
                15f, Color.rgb(219, 216, 226)).apply {
                gravity = Gravity.RIGHT or Gravity.TOP; maxLines = 6; setLineSpacing(0f, 1.15f)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(8) })

            if (resumeMs > 30_000L && durationMs > 0L) {
                val pct = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(V339Ui.text(this@MovieDetailsActivity, "متابعة المشاهدة  •  $pct%", 13f, V339Ui.PURPLE_LIGHT).apply { gravity = Gravity.RIGHT })
            }

            val actions = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_LTR
            }
            val play = V339Ui.button(this@MovieDetailsActivity, if (resumeMs > 30_000L) "▶  استئناف" else "▶  شاهد الآن", true).apply {
                setOnClickListener { openPlayer(provider, stream, url, resumeMs) }
            }
            actions.addView(play, LinearLayout.LayoutParams(dp(190), dp(56)))
            if (resumeMs > 30_000L) {
                val restart = V339Ui.button(this@MovieDetailsActivity, "↺  من البداية", false).apply {
                    setOnClickListener { openPlayer(provider, stream, url, 0L) }
                }
                actions.addView(restart, LinearLayout.LayoutParams(dp(140), dp(56)).apply { leftMargin = dp(8) })
            }
            favoriteButton = V339Ui.button(this@MovieDetailsActivity, if (stream.favorite) "★ المفضلة" else "☆ المفضلة", false).apply {
                setOnClickListener {
                    lifecycleScope.launch {
                        val current = dao.stream(contentKey) ?: return@launch
                        dao.setFavorite(contentKey, !current.favorite)
                        text = if (!current.favorite) "★ المفضلة" else "☆ المفضلة"
                    }
                }
            }
            actions.addView(favoriteButton, LinearLayout.LayoutParams(dp(145), dp(56)).apply { leftMargin = dp(8) })
            lockButton = V339Ui.button(this@MovieDetailsActivity, if (stream.locked) "🔒 مقفل" else "🔓 قفل", false).apply {
                setOnClickListener {
                    lifecycleScope.launch {
                        val current = dao.stream(contentKey) ?: return@launch
                        if (current.locked) ParentalGate.requirePin(this@MovieDetailsActivity) { lifecycleScope.launch { dao.setLocked(contentKey, false); lockButton.text = "🔓 قفل" } }
                        else if (!ParentalPinManager.hasPin(this@MovieDetailsActivity)) ParentalGate.requirePin(this@MovieDetailsActivity) { lifecycleScope.launch { dao.setLocked(contentKey, true); lockButton.text = "🔒 مقفل" } }
                        else { dao.setLocked(contentKey, true); lockButton.text = "🔒 مقفل" }
                    }
                }
            }
            actions.addView(lockButton, LinearLayout.LayoutParams(dp(120), dp(56)).apply { leftMargin = dp(8) })
            info.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)))

            hero.addView(info, FrameLayout.LayoutParams(0, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.RIGHT).apply {
                width = dp(820); rightMargin = dp(22)
            })
            page.addView(hero, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            play.requestFocus()
        }
    }

    private fun openPlayer(provider: ProviderEntity, stream: StreamEntity, url: String, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "movie"); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_TITLE, stream.name); putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
        })
    }

    private fun dp(v: Int) = V339Ui.dp(this, v)
    companion object { const val EXTRA_PROVIDER_ID = "provider_id"; const val EXTRA_CONTENT_KEY = "content_key" }
}
