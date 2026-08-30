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
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.series.EpisodesActivity

class SeriesDetailsActivity : AppCompatActivity() {
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
            setPadding(76, 56, 76, 56)
        }
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                textSize = 36f
                setTextColor(Color.WHITE)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "مسلسل  •  المواسم والحلقات محلية بعد المزامنة"
                textSize = 16f
                setTextColor(Color.rgb(190, 165, 225))
                setPadding(0, 8, 0, 26)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "لا يوجد تشغيل تلقائي في صفحة التفاصيل. افتح الحلقات، اختر الموسم والحلقة، ثم يبدأ التشغيل بالرابط الأصلي للحلقة."
                textSize = 17f
                setTextColor(Color.rgb(220, 220, 225))
                setPadding(0, 0, 0, 30)
            })

            val row = LinearLayout(this@SeriesDetailsActivity).apply { orientation = LinearLayout.HORIZONTAL }
            val episodes = actionButton("الحلقات") {
                startActivity(Intent(this@SeriesDetailsActivity, EpisodesActivity::class.java).apply {
                    putExtra(EpisodesActivity.EXTRA_PROVIDER_ID, providerId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_ID, stream.remoteId)
                    putExtra(EpisodesActivity.EXTRA_SERIES_NAME, stream.name)
                })
            }
            row.addView(episodes, LinearLayout.LayoutParams(230, 82).apply { marginEnd = 14 })

            favoriteButton = actionButton(if (stream.favorite) "★ في المفضلة" else "☆ المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★ في المفضلة" else "☆ المفضلة"
                }
            }
            row.addView(favoriteButton, LinearLayout.LayoutParams(230, 82))
            panel.addView(row)
            episodes.requestFocus()
        }
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
