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
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.playback.ExternalPlayerLauncher
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.core.security.ParentalPinManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
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
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)

            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.name
                textSize = 36f
                setTextColor(Color.WHITE)
            })
            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildList {
                    add("فيلم")
                    stream.year?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.genre?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.duration?.takeIf { it.isNotBlank() }?.let(::add)
                    stream.rating?.takeIf { it.isNotBlank() }?.let { add("★ $it") }
                    stream.extension?.takeIf { it.isNotBlank() }?.let { add(it.uppercase()) }
                    if ((watch?.positionMs ?: 0L) > 30_000L) add("لديك مشاهدة سابقة")
                }.joinToString("  •  ")
                textSize = 16f
                setTextColor(Color.rgb(190, 165, 225))
                setPadding(0, 8, 0, 22)
            })
            panel.addView(TextView(this@MovieDetailsActivity).apply {
                text = stream.plot?.takeIf { it.isNotBlank() } ?: "التشغيل يبدأ فقط عند اختيارك."
                textSize = 17f
                maxLines = 5
                setTextColor(Color.rgb(220, 220, 225))
                setPadding(0, 0, 0, 30)
            })

            val row = LinearLayout(this@MovieDetailsActivity).apply { orientation = LinearLayout.HORIZONTAL }
            val resumeMs = watch?.positionMs ?: 0L
            val play = actionButton(if (resumeMs > 30_000L) "استئناف" else "تشغيل") {
                openPlayer(provider.id, stream.key, stream.name, url, resumeMs)
            }
            row.addView(play, LinearLayout.LayoutParams(190, 82).apply { marginEnd = 10 })
            if (resumeMs > 30_000L) {
                row.addView(actionButton("من البداية") { openPlayer(provider.id, stream.key, stream.name, url, 0L) }, LinearLayout.LayoutParams(190, 82).apply { marginEnd = 10 })
            }
            row.addView(actionButton("مشغل خارجي") {
                if (!ExternalPlayerLauncher.launch(this@MovieDetailsActivity, url, stream.name)) Toast.makeText(this@MovieDetailsActivity, "لا يوجد مشغل خارجي مناسب", Toast.LENGTH_SHORT).show()
            }, LinearLayout.LayoutParams(190, 82).apply { marginEnd = 10 })

            favoriteButton = actionButton(if (stream.favorite) "★ المفضلة" else "☆ المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★ المفضلة" else "☆ المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(185, 82).apply { marginEnd = 10 })

            lockButton = actionButton(if (stream.locked) "🔒 مقفل" else "🔓 قفل") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    if (current.locked) {
                        ParentalGate.requirePin(this@MovieDetailsActivity) {
                            lifecycleScope.launch {
                                dao.setLocked(contentKey, false)
                                lockButton.text = "🔓 قفل"
                            }
                        }
                    } else {
                        if (!ParentalPinManager.hasPin(this@MovieDetailsActivity)) {
                            ParentalGate.requirePin(this@MovieDetailsActivity) {
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
            row.addView(lockButton, LinearLayout.LayoutParams(175, 82))
            panel.addView(row)
            play.requestFocus()
        }
    }

    private fun openPlayer(providerId: String, contentKey: String, title: String, url: String, resumeMs: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, contentKey)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, providerId)
            putExtra(PlayerActivity.EXTRA_KIND, "movie")
            putExtra(PlayerActivity.EXTRA_TITLE, title)
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resumeMs)
        })
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
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
