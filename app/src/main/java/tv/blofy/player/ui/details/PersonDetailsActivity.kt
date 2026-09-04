package tv.blofy.player.ui.details

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

class PersonDetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val personName = intent.getStringExtra(EXTRA_NAME).orEmpty()
        val suppliedProfile = intent.getStringExtra(EXTRA_PROFILE)
        if (personName.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(48), dp(34), dp(48), dp(30))
            setBackgroundColor(0xFF090711.toInt())
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        val portrait = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xFF181020.toInt()) }
            clipToOutline = true
        }
        header.addView(portrait, LinearLayout.LayoutParams(dp(150), dp(190)).apply { marginStart = dp(26) })
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            addView(TextView(this@PersonDetailsActivity).apply {
                text = "BLOFY CAST"; textSize = 11.5f; letterSpacing = .12f; typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.RIGHT
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = personName; textSize = 34f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = "الاسم والصورة من بيانات السيرفر"; textSize = 13.5f; typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT; setPadding(0, dp(8), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, dp(190), 1f))
        root.addView(header)
        root.addView(TextView(this).apply {
            text = "تُعرض بيانات الممثل التي يرسلها السيرفر فقط. إذا لم يرسل السيرفر صورة أو معلومات إضافية فلن يستخدم BLOFY مصدرًا خارجيًا."
            textSize = 14f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT; setLineSpacing(0f, 1.2f); setPadding(0, dp(24), 0, 0)
        })
        setContentView(root)
        suppliedProfile?.takeIf(String::isNotBlank)?.let { ArtworkLoader.load(portrait, it) }
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    companion object { const val EXTRA_NAME = "person_name"; const val EXTRA_PROFILE = "person_profile" }
}
