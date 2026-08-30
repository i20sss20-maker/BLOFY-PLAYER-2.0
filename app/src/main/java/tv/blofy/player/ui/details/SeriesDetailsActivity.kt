package tv.blofy.player.ui.details

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
            setPadding(70, 54, 70, 54)
        }
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }

            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = stream.name
                textSize = 34f
                setTextColor(Color.WHITE)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "مسلسل  •  الحلقات مرتبة تصاعديًا داخل BLOFY"
                textSize = 16f
                setTextColor(Color.rgb(190, 165, 225))
                setPadding(0, 8, 0, 26)
            })
            panel.addView(TextView(this@SeriesDetailsActivity).apply {
                text = "صفحة مستقلة للمسلسل بدون تشغيل تلقائي. اختر الحلقات للدخول إلى المواسم والحلقات المحفوظة محليًا."
                textSize = 17f
                setTextColor(Color.rgb(220, 220, 225))
                setPadding(0, 0, 0, 28)
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
