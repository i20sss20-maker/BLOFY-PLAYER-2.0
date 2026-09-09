package tv.blofy.player.ui.details

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
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
            setPadding(dp(48), dp(36), dp(48), dp(32))
            background = AppCompatResources.getDrawable(this@PersonDetailsActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY  •  CAST"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(-1, dp(30)))

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(22), dp(26), dp(22))
            background = BlofyTvDesign.glassSurface(dp(24).toFloat(), false)
            elevation = dp(5).toFloat()
        }
        val portraitFrame = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = BlofyTvDesign.surface(dp(20).toFloat(), false)
        }
        val portrait = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply {
                cornerRadius = dp(17).toFloat()
                setColor(BlofyTvDesign.Surface)
                setStroke(dp(1), BlofyTvDesign.Divider)
            }
            clipToOutline = true
            setImageResource(R.drawable.blofy_logo)
        }
        portraitFrame.addView(portrait, LinearLayout.LayoutParams(dp(154), dp(194)))
        panel.addView(portraitFrame, LinearLayout.LayoutParams(dp(166), dp(206)).apply { marginEnd = dp(28) })

        panel.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            layoutDirection = uiDirection
            addView(TextView(this@PersonDetailsActivity).apply {
                text = getString(R.string.person_server_identity)
                textSize = 12.5f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.END
                includeFontPadding = false
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = personName
                textSize = 36f
                typeface = BlofyTvDesign.DisplayTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
                includeFontPadding = false
                setPadding(0, dp(4), 0, dp(10))
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = getString(R.string.person_server_only_note)
                textSize = 14f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.END
                setLineSpacing(0f, 1.18f)
                maxLines = 4
            })
        }, LinearLayout.LayoutParams(0, dp(206), 1f))

        root.addView(panel, LinearLayout.LayoutParams(-1, dp(250)).apply { topMargin = dp(8) })
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 11f
            letterSpacing = .08f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(12) })

        setContentView(root)
        suppliedProfile?.takeIf(String::isNotBlank)?.let { ArtworkLoader.load(portrait, it) }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_NAME = "person_name"
        const val EXTRA_PROFILE = "person_profile"
    }
}
