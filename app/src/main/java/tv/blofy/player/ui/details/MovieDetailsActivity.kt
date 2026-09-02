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
            alpha = 0.18f
            setBackgroundColor(BlofyTvDesign.Background)
        }
        root.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xE6FFFFFF.toInt(), 0xF8F7F4FA.toInt(), 0xFCF5F3F8.toInt()))
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(58), dp(34), dp(58), dp(34))
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

            val info = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                clipChildren = false
                setPadding(dp(34), dp(30), dp(34), dp(30))
                background = BlofyTvDesign.elevatedSurface(dp(28).toFloat())
                elevation = dp(7).toFloat()
            }
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = "BLOFY  •  فيلم"
                textSize = BlofyTvDesign.CaptionSp
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.PurpleDeep)
                gravity = Gravity.RIGHT
                includeFontPadding = false
                background = BlofyTvDesign.badge(dp(14).toFloat())
                setPadding(dp(13), dp(6), dp(13), dp(6))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.name
                BlofyTvDesign.applyHeroTitle(this)
                textSize = 42f
                gravity = Gravity.RIGHT
                maxLines = 2
                includeFontPadding = false
            })

            val metaRow = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }
            metaRow.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildList {
                    stream.year?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.genre?.takeIf { it.isNotBlank() }?.substringBefore(',')?.let(::add)
                    stream.duration?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.extension?.takeIf { it.isNotBlank() }?.let { add(it.uppercase()) }
                }.joinToString("  •  ")
                textSize = 15f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(0, dp(44), 1f))
            stream.rating?.takeIf { it.isNotBlank() }?.let { rating ->
                metaRow.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "★  $rating"
                    textSize = 14f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.PurpleDeep)
                    gravity = Gravity.CENTER
                    background = BlofyTvDesign.badge(dp(14).toFloat())
                    setPadding(dp(13), dp(7), dp(13), dp(7))
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) })
            }
            info.addView(metaRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(5); bottomMargin = dp(10) })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "استمتع بالمشاهدة على BLOFY PLAYER"
                BlofyTvDesign.applyBody(this)
                textSize = 16f
                maxLines = 5
                gravity = Gravity.RIGHT
                setLineSpacing(dp(2).toFloat(), 1.14f)
                setPadding(0, 0, 0, dp(20))
            })

            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val percent = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "◷  متابعة المشاهدة  •  $percent%"
                    textSize = 14f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.TextSecondary)
                    gravity = Gravity.RIGHT
                    setPadding(dp(13), dp(8), dp(13), dp(8))
                    background = BlofyTvDesign.badge(dp(14).toFloat())
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })
            }

            val row = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.RIGHT
                clipChildren = false
            }
            val play = actionButton(if (resumeMs > 30_000L) "▶  استئناف" else "▶  شاهد الآن", primary = true) { openPlayer(provider, stream, url, resumeMs) }
            row.addView(play, LinearLayout.LayoutParams(dp(202), dp(60)).apply { marginStart = dp(10) })
            if (resumeMs > 30_000L) row.addView(actionButton("↺  من البداية") { openPlayer(provider, stream, url, 0L) }, LinearLayout.LayoutParams(dp(176), dp(60)).apply { marginStart = dp(10) })
            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(172), dp(60)).apply { marginStart = dp(10) })
            info.addView(row)
            body.addView(info, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(34) })

            val posterCard = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(8), dp(8), dp(8), dp(8))
                background = BlofyTvDesign.elevatedSurface(dp(24).toFloat())
                elevation = dp(8).toFloat()
            }
            val poster = ImageView(this@MovieDetailsActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(BlofyTvDesign.Surface) }
            posterCard.addView(poster, LinearLayout.LayoutParams(dp(248), dp(372)))
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))
            body.addView(posterCard, LinearLayout.LayoutParams(dp(264), dp(388)))
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
        textSize = 15f
        typeface = BlofyTvDesign.BodyTypeface
        includeFontPadding = false
        setTextColor(if (primary) Color.WHITE else BlofyTvDesign.TextPrimary)
        BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.04f, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = if (primary) BlofyTvDesign.primaryButton(dp(18).toFloat(), focused) else BlofyTvDesign.secondaryButton(dp(18).toFloat(), focused)
            setTextColor(if (primary) Color.WHITE else if (focused) BlofyTvDesign.PurpleDeep else BlofyTvDesign.TextPrimary)
            view.animate().scaleX(if (focused) 1.04f else 1f).scaleY(if (focused) 1.04f else 1f).translationZ(if (focused) dp(18).toFloat() else dp(2).toFloat()).setDuration(100).start()
        }
        setOnClickListener { action() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
