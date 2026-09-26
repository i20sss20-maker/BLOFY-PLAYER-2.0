package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.ui.common.BlofyTvDesign

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val compact = resources.configuration.screenWidthDp < 400 || resources.configuration.screenHeightDp < 700
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = AppCompatResources.getDrawable(this@SplashActivity, R.drawable.blofy_home_background)
            setPadding(dp(if (compact) 18 else 32), dp(if (compact) 18 else 32), dp(if (compact) 18 else 32), dp(if (compact) 18 else 32))
        }
        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(if (compact) 170 else 220), dp(if (compact) 102 else 132)))
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = if (compact) 21f else 24f
            typeface = BlofyTvDesign.HeadingTypeface
            letterSpacing = 0.08f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(if (compact) 44 else 54)))
        root.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
        }, LinearLayout.LayoutParams(dp(if (compact) 38 else 44), dp(if (compact) 38 else 44)).apply { topMargin = dp(if (compact) 10 else 14) })
        root.addView(TextView(this).apply {
            text = "جاري تجهيز BLOFY..."
            textSize = 13.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)).apply { topMargin = dp(8) })
        setContentView(root)

        lifecycleScope.launch {
            delay(550)
            startActivity(Intent(this@SplashActivity, LoginActivity::class.java))
            finish()
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
