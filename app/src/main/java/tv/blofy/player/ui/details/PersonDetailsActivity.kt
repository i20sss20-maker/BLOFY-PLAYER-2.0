package tv.blofy.player.ui.details

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.R
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

class PersonDetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val personName = intent.getStringExtra(EXTRA_NAME).orEmpty()
        val suppliedProfile = intent.getStringExtra(EXTRA_PROFILE)
        if (personName.isBlank()) { finish(); return }
        val uiDirection = resources.configuration.layoutDirection

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            gravity = Gravity.TOP
            setPadding(dp(48), dp(34), dp(48), dp(30))
            setBackgroundColor(0xFF090711.toInt())
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            gravity = Gravity.CENTER_VERTICAL
        }
        val portrait = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xFF181020.toInt()) }
            clipToOutline = true
        }
        header.addView(portrait, LinearLayout.LayoutParams(dp(150), dp(190)).apply { marginEnd = dp(26) })
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            addView(TextView(this@PersonDetailsActivity).apply {
                text = "BLOFY CAST"; textSize = 11.5f; letterSpacing = .12f; typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.END
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = personName; textSize = 34f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(Color.WHITE); gravity = Gravity.END
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = getString(R.string.person_server_identity); textSize = 13.5f; typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.END; setPadding(0, dp(8), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, dp(190), 1f))
        root.addView(header)
        root.addView(TextView(this).apply {
            text = getString(R.string.person_server_only_note)
            textSize = 14f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.END; setLineSpacing(0f, 1.2f); setPadding(0, dp(24), 0, 0)
        })
        setContentView(root)
        suppliedProfile?.takeIf(String::isNotBlank)?.let { ArtworkLoader.load(portrait, it) }
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    companion object { const val EXTRA_NAME = "person_name"; const val EXTRA_PROFILE = "person_profile" }
}