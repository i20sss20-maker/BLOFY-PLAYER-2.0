package tv.blofy.player.ui.details

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) {
            finish(); return
        }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(5, 5, 10)) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(70, 54, 70, 54)
        }
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)

            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.name
                textSize = 34f
                setTextColor(Color.WHITE)
            })
            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildString {
                    append("فيلم")
                    stream.extension?.takeIf { it.isNotBlank() }?.let { append("  •  ").append(it.uppercase()) }
                    stream.addedAt?.let { append("  •  محفوظ محليًا") }
                }
                textSize = 16f
                setTextColor(Color.rgb(190, 165, 225))
                setPadding(0, 8, 0, 26)
            })

            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = "BLOFY PLAYER يعرض بيانات الفيلم من قائمتك المحلية ويبدأ التشغيل بالرابط الأصلي للمزود بدون تخمينات إضافية."
                textSize = 17f
                setTextColor(Color.rgb(220, 220, 225))
                setPadding(0, 0, 0, 28)
            })

            val row = LinearLayout(this@MovieDetailsActivity).apply { orientation = LinearLayout.HORIZONTAL }
            val play = actionButton(if ((watch?.positionMs ?: 0L) > 30_000L) "استئناف" else "تشغيل") {
                val resume = watch?.positionMs ?: 0L
                startActivity(Intent(this@MovieDetailsActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.movie(provider, stream))
                    putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                    putExtra(PlayerActivity.EXTRA_KIND, "movie")
                    putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                    putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
                })
            }
            row.addView(play, LinearLayout.LayoutParams(230, 82).apply { marginEnd = 14 })

            if ((watch?.positionMs ?: 0L) > 30_000L) {
                row.addView(actionButton("من البداية") {
                    startActivity(Intent(this@MovieDetailsActivity, PlayerActivity::class.java).apply {
                        putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.movie(provider, stream))
                        putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                        putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                        putExtra(PlayerActivity.EXTRA_KIND, "movie")
                        putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                        putExtra(PlayerActivity.EXTRA_RESUME_MS, 0L)
                    })
                }, LinearLayout.LayoutParams(230, 82).apply { marginEnd = 14 })
            }

            favoriteButton = actionButton(if (stream.favorite) "★ في المفضلة" else "☆ المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★ في المفضلة" else "☆ المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(230, 82))
            panel.addView(row)
            play.requestFocus()
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        isFocusable = true
        background = GradientDrawable().apply {
            cornerRadius = 18f
            setColor(Color.rgb(52, 25, 88))
            setStroke(2, Color.rgb(160, 105, 235))
        }
        setTextColor(Color.WHITE)
        setOnClickListener { action() }
    }

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
