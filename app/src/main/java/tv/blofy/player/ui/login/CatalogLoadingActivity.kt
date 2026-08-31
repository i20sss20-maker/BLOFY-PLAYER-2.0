package tv.blofy.player.ui.login

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R

/** Visual hand-off used while the login flow prepares a complete local catalog. */
class CatalogLoadingActivity : AppCompatActivity() {
    private lateinit var percent: TextView
    private lateinit var stage: TextView
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(80), dp(60), dp(80), dp(60))
            background = AppCompatResources.getDrawable(this@CatalogLoadingActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"; textSize = 34f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "جاري تجهيز مكتبتك"; textSize = 24f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, dp(18), 0, dp(8))
        })
        stage = TextView(this).apply { text = "التحقق من القائمة..."; textSize = 17f; setTextColor(0xFFBCA8D7.toInt()); gravity = Gravity.CENTER }
        root.addView(stage)
        percent = TextView(this).apply { text = "0%"; textSize = 52f; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFF8D5CFF.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(28), 0, dp(14)) }
        root.addView(percent)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; progress = 0; progressDrawable = progressDrawable.mutate() }
        root.addView(progress, LinearLayout.LayoutParams(dp(620), dp(18)))
        root.addView(TextView(this).apply {
            text = "يتم تنزيل القنوات والأفلام والمسلسلات وحفظها محليًا قبل الدخول"; textSize = 14f; setTextColor(0xFF9B91A8.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(22), 0, 0)
        })
        setContentView(root)
        render(intent.getIntExtra(EXTRA_PERCENT, 0), intent.getStringExtra(EXTRA_STAGE).orEmpty())
    }

    private fun render(value: Int, label: String) {
        val safe = value.coerceIn(0, 100); progress.progress = safe; percent.text = "$safe%"; if (label.isNotBlank()) stage.text = label
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object { const val EXTRA_PERCENT = "catalog_percent"; const val EXTRA_STAGE = "catalog_stage" }
}
