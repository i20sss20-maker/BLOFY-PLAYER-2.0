package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
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
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button
    private val headingTypeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    private val bodyTypeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = FrameLayout(this).apply {
            background = AppCompatResources.getDrawable(this@MovieDetailsActivity, R.drawable.blofy_home_background)
            clipChildren = false
        }
        val backdrop = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.34f
            setBackgroundColor(0xFF06050A.toInt())
        }
        root.addView(backdrop, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xFB07050C.toInt(), 0xD70B0711.toInt(), 0x8D130C1E.toInt(), 0x4A170B29.toInt())
            )
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(68), dp(46), dp(68), dp(46))
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
                setPadding(dp(10), dp(10), dp(10), dp(10))
                background = cardBackground()
                elevation = dp(8).toFloat()
            }
            val poster = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(0xFF15101F.toInt())
            }
            posterCard.addView(poster, LinearLayout.LayoutParams(dp(300), dp(448)))
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))
            body.addView(posterCard, LinearLayout.LayoutParams(dp(324), dp(472)).apply { marginStart = dp(48) })

            val info = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.END
                layoutDirection = View.LAYOUT_DIRECTION_RTL
            }
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = "BLOFY  •  فيلم"
                textSize = 13.5f
                typeface = bodyTypeface
                setTextColor(ACCENT_MINT)
                gravity = Gravity.END
                includeFontPadding = false
                background = badgeBackground()
                setPadding(dp(12), dp(6), dp(12), dp(6))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.name
                textSize = 43f
                typeface = headingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
                includeFontPadding = false
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
                typeface = bodyTypeface
                setTextColor(0xFFD4B4EE.toInt())
                gravity = Gravity.END
                setPadding(0, dp(10), 0, dp(20))
            })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "استمتع بالمشاهدة على BLOFY PLAYER"
                textSize = 17.5f
                typeface = bodyTypeface
                maxLines = 6
                setTextColor(0xFFE9E4EE.toInt())
                gravity = Gravity.END
                setLineSpacing(dp(2).toFloat(), 1.16f)
                setPadding(0, 0, 0, dp(26))
            })

            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val percent = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "◷  متابعة المشاهدة  •  $percent%"
                    textSize = 15f
                    typeface = bodyTypeface
                    setTextColor(0xFFD7C3E5.toInt())
                    gravity = Gravity.END
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                    background = progressBackground()
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })
            }

            val row = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.END
                clipChildren = false
            }
            val play = actionButton(if (resumeMs > 30_000L) "▶  استئناف" else "▶  شاهد الآن", primary = true) {
                openPlayer(provider, stream, url, resumeMs)
            }
            row.addView(play, LinearLayout.LayoutParams(dp(215), dp(72)).apply { marginStart = dp(12) })
            if (resumeMs > 30_000L) {
                row.addView(actionButton("↺  من البداية") { openPlayer(provider, stream, url, 0L) }, LinearLayout.LayoutParams(dp(190), dp(72)).apply { marginStart = dp(12) })
            }
            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(185), dp(72)).apply { marginStart = dp(12) })
            info.addView(row)
            body.addView(info, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            play.requestFocus()
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
        typeface = bodyTypeface
        isFocusable = true
        includeFontPadding = false
        setTextColor(Color.WHITE)
        background = buttonBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused, primary)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.045f else 1f)
                .scaleY(if (focused) 1.045f else 1f)
                .translationZ(if (focused) 20f else 2f)
                .setDuration(if (focused) 115L else 90L)
                .start()
        }
        setOnClickListener { action() }
    }

    private fun cardBackground() = GradientDrawable().apply {
        cornerRadius = dp(26).toFloat()
        setColor(0xD9140E1C.toInt())
        setStroke(dp(1), 0x805D3E78.toInt())
    }

    private fun badgeBackground() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(0x99221631.toInt())
        setStroke(dp(1), 0x665D4779)
    }

    private fun progressBackground() = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(0x9A1A1125.toInt())
        setStroke(dp(1), 0x554D3764)
    }

    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            focused -> intArrayOf(0xFF9552DD.toInt(), 0xFF692EBC.toInt())
            primary -> intArrayOf(0xFF7337C4.toInt(), 0xFF4A1F8B.toInt())
            else -> intArrayOf(0xE61B1428.toInt(), 0xED100B19.toInt())
        }
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFF0DDFF.toInt() else 0x66533A69)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
        private const val ACCENT_MINT = 0xFF78EAD3.toInt()
    }
}
