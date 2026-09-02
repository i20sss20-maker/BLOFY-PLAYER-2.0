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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = FrameLayout(this).apply { background = AppCompatResources.getDrawable(this@MovieDetailsActivity, R.drawable.blofy_home_background) }
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(58), dp(44), dp(58), dp(44))
        }
        root.addView(body, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)

            val posterCard = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(10), dp(10), dp(10), dp(10)); background = cardBackground()
            }
            val poster = ImageView(this@MovieDetailsActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(0xFF15101F.toInt()) }
            posterCard.addView(poster, LinearLayout.LayoutParams(dp(285), dp(425)))
            ArtworkLoader.load(poster, listOf(stream.icon, stream.backdrop))
            body.addView(posterCard, LinearLayout.LayoutParams(dp(310), dp(450)).apply { marginStart = dp(34) })

            val info = LinearLayout(this@MovieDetailsActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.END }
            info.addView(TextView(this@MovieDetailsActivity).apply { text = stream.name; textSize = 38f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.END })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildList {
                    add("فيلم"); stream.year?.takeIf { it.isNotBlank() }?.let(::add); stream.genre?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.duration?.takeIf { it.isNotBlank() }?.let(::add); stream.rating?.takeIf { it.isNotBlank() }?.let { add("★ $it") }
                    stream.extension?.takeIf { it.isNotBlank() }?.let { add(it.uppercase()) }
                }.joinToString("  •  ")
                textSize = 16f; setTextColor(0xFFC6A8E7.toInt()); gravity = Gravity.END; setPadding(0, dp(8), 0, dp(18))
            })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "استمتع بالمشاهدة على BLOFY PLAYER"
                textSize = 17f; maxLines = 6; setTextColor(0xFFE0DCE5.toInt()); gravity = Gravity.END; setLineSpacing(0f, 1.18f); setPadding(0, 0, 0, dp(24))
            })

            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val percent = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "متابعة المشاهدة  •  $percent%"; textSize = 15f; setTextColor(0xFFBCA8D7.toInt()); gravity = Gravity.END; setPadding(0, 0, 0, dp(12))
                })
            }

            val row = LinearLayout(this@MovieDetailsActivity).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.END }
            val play = actionButton(if (resumeMs > 30_000L) "▶ استئناف" else "▶ شاهد الآن") { openPlayer(provider, stream, url, resumeMs) }
            row.addView(play, LinearLayout.LayoutParams(dp(195), dp(74)).apply { marginStart = dp(10) })
            if (resumeMs > 30_000L) row.addView(actionButton("من البداية") { openPlayer(provider, stream, url, 0L) }, LinearLayout.LayoutParams(dp(175), dp(74)).apply { marginStart = dp(10) })
            favoriteButton = actionButton(if (stream.favorite) "★ المفضلة" else "☆ المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★ المفضلة" else "☆ المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(dp(175), dp(74)).apply { marginStart = dp(10) })
            info.addView(row)
            body.addView(info, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
            play.requestFocus()
        }
    }

    private fun openPlayer(provider: ProviderEntity, stream: StreamEntity, url: String, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key); putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "movie"); putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport); putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_TITLE, stream.name); putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
        })
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f; isFocusable = true; setTextColor(Color.WHITE); background = buttonBackground(false)
        setOnFocusChangeListener { view, focused -> view.background = buttonBackground(focused); view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).setDuration(100).start() }
        setOnClickListener { action() }
    }
    private fun cardBackground() = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(0xD9181225.toInt()); setStroke(dp(1), 0x66533B68) }
    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat(); setColor(if (focused) 0xFF6934A0.toInt() else 0xD91A1429.toInt()); setStroke(if (focused) dp(2) else dp(1), if (focused) Color.WHITE else 0x66503A64)
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    companion object { const val EXTRA_PROVIDER_ID = "provider_id"; const val EXTRA_CONTENT_KEY = "content_key" }
}
