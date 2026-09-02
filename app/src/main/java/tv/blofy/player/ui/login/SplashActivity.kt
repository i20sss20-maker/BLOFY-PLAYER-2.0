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

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = AppCompatResources.getDrawable(this@SplashActivity, R.drawable.blofy_home_background)
            setPadding(dp(32), dp(32), dp(32), dp(32))
        }
        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(220), dp(132)))
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 24f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            letterSpacing = 0.08f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(54)))
        root.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(0xFFB96CFF.toInt())
        }, LinearLayout.LayoutParams(dp(44), dp(44)).apply { topMargin = dp(14) })
        root.addView(TextView(this).apply {
            text = "جاري تجهيز BLOFY..."
            textSize = 13.5f
            setTextColor(0xFFB8ABC7.toInt())
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
