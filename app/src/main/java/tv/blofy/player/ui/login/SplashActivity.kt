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
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.common.BlofyTvDesign

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val statusView = TextView(this).apply {
            text = if (BuildConfig.CODE_ONLY_LOGIN) "جارِ فتح BLOFY STREAM..." else getString(R.string.splash_opening)
            textSize = 13.5f
            setTextColor(0xFFB8ABC7.toInt())
            gravity = Gravity.CENTER
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = AppCompatResources.getDrawable(this@SplashActivity, R.drawable.blofy_home_background)
            setPadding(dp(32), dp(32), dp(32), dp(32))
        }
        root.addView(ImageView(this).apply {
            setImageResource(if (BuildConfig.CODE_ONLY_LOGIN) {
                resources.getIdentifier("blofy_stream_brand","drawable",packageName)
                    .takeIf { it!=0 } ?: R.drawable.blofy_logo
            } else R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(220), dp(132)))
        root.addView(TextView(this).apply {
            text = if (BuildConfig.CODE_ONLY_LOGIN) "BLOFY STREAM" else getString(R.string.brand_player)
            textSize = 24f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            letterSpacing = 0.08f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(54)))
        root.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(0xFFB96CFF.toInt())
        }, LinearLayout.LayoutParams(dp(44), dp(44)).apply { topMargin = dp(14) })
        root.addView(statusView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)).apply { topMargin = dp(8) })
        setContentView(root)

        // Startup still never waits for Room, migrations, catalog recovery or the network.
        // A successful Home visit leaves a tiny synchronous hint so returning users can skip Login.
        lifecycleScope.launch {
            delay(MINIMUM_SPLASH_MS)
            if (isFinishing || isDestroyed) return@launch
            val destination = if (BuildConfig.CODE_ONLY_LOGIN) {
                CodeOnlyLoginActivity::class.java
            } else if (StartupEntryState.shouldOpenHome(this@SplashActivity)) {
                HomeActivity::class.java
            } else {
                LoginActivity::class.java
            }
            startActivity(Intent(this@SplashActivity, destination))
            finish()
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val MINIMUM_SPLASH_MS = 60L
    }
}
