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
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = FrameLayout(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@MovieDetailsActivity, R.drawable.blofy_home_background)
            clipChildren = false
        }
        val backdrop = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.42f
            setBackgroundColor(BlofyTvDesign.Background)
        }
        root.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xFA07050C.toInt(), 0xED0A0710.toInt(), 0xC50E0918.toInt(), 0x5A160B26.toInt())
            )
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(72), dp(42), dp(72), dp(42))
            clipChildren = false
        }
        root.addView(body, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)

            ArtworkLoader.load(backdrop, listOf(stream.backdrop, stream.icon))

            val posterCard = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(9), dp(9), dp(9), dp(9))
                background = BlofyTvDesign.elevatedSurface(dp(28).toFloat())
                elevation = dp(12).toFloat()
            }
            val poster = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(BlofyTvDesign.Surface)
            }
            posterCard.addView(poster, LinearLayout.LayoutParams(dp(286), dp(430)))
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))
            body.addView(posterCard, LinearLayout.LayoutParams(dp(306), dp(450)).apply { marginStart = dp(52) })

            val info = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                clipChildren = false
            }
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = "BLOFY  •  فيلم"
                textSize = BlofyTvDesign.CaptionSp
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.Mint)
                gravity = Gravity.RIGHT
                includeFontPadding = false
                background = BlofyTvDesign.badge(dp(14).toFloat())
                setPadding(dp(13), dp(7), dp(13), dp(7))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(14) })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.name
                BlofyTvDesign.applyHeroTitle(this)
                gravity = Gravity.RIGHT
                maxLines = 2
            })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildList {
                    stream.year?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.genre?.takeIf { it.isNotBlank() }?.substringBefore(',')?.let(::add)
                    stream.duration?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.rating?.takeIf { it.isNotBlank() }?.let { add("★ $it") }
                    stream.extension?.takeIf { it.isNotBlank() }?.let { add(it.uppercase()) }
                }.joinToString("  •  ")
                textSize = 16f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.RIGHT
                setPadding(0, dp(10), 0, dp(20))
            })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "استمتع بالمشاهدة على BLOFY PLAYER"
                BlofyTvDesign.applyBody(this)
                maxLines = 6
                gravity = Gravity.RIGHT
                setLineSpacing(dp(2).toFloat(), 1.16f)
                setPadding(0, 0, 0, dp(26))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(10) })

            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val percent = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "◷  متابعة المشاهدة  •  $percent%"
                    textSize = 15f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.TextSecondary)
                    gravity = Gravity.RIGHT
                    setPadding(dp(13), dp(9), dp(13), dp(9))
                    background = BlofyTvDesign.badge(dp(14).toFloat())
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(18) })
            }

            val row = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.RIGHT
                clipChildren = false
            }
            val play = actionButton(if (resumeMs > 30_000L) "▶  استئناف" else "▶  شاهد الآن", primary = true) {
                openPlayer(provider, stream, url, resumeMs)
            }
            row.addView(play, LinearLayout.LayoutParams(dp(220), dp(68)).apply { marginStart = dp(12) })
            if (resumeMs > 30_000L) {
                row.addView(actionButton("↺  من البداية") { openPlayer(provider, stream, url, 0L) }, LinearLayout.LayoutParams(dp(190), dp(68)).apply { marginStart = dp(12) })
            }
            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(185), dp(68)).apply { marginStart = dp(12) })
            info.addView(row)
            body.addView(info, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            play.post { play.requestFocus() }
        }
    }

    private fun openPlayer(provider: ProviderEntity, stream: StreamEntity, url: String, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "movie")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
        })
    }

    private fun actionButton(label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15.5f
        typeface = BlofyTvDesign.BodyTypeface
        includeFontPadding = false
        setTextColor(Color.WHITE)
        BlofyTvDesign.installTvFocus(this, dp(19).toFloat(), 1.045f, primary)
        setOnClickListener { action() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
