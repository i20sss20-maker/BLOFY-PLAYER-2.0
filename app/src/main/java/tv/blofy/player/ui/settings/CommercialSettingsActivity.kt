package tv.blofy.player.ui.settings

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import tv.blofy.player.ui.common.CinemaStyle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.commercial.CommercialConfigRepository
import tv.blofy.player.core.commercial.CommercialRuntime

class CommercialSettingsActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var imageButton: SettingCard
    private lateinit var safeButton: SettingCard
    private val prefs by lazy { getSharedPreferences("blofy_player_settings", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(24), dp(28), dp(24))
            setBackgroundColor(CinemaStyle.Background)
        }
        page.addView(TextView(this).apply {
            text = "BLOFY"
            textSize = 12f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFB574FF.toInt())
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(-1, dp(30)))
        page.addView(TextView(this).apply {
            text = "جودة الصور والأداء"
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(-1, dp(58)))

        status = TextView(this).apply {
            textSize = 13f
            setTextColor(0xFFD9CBE8.toInt())
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(18), 0)
            background = card(false)
        }
        page.addView(status, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(18) })
        status.setPadding(dp(18), dp(16), dp(18), dp(16))

        imageButton = actionButton("") { cycleImageMode() }
        safeButton = actionButton("") { toggleSafeMode() }
        val refresh = actionButton("تحديث نمط العرض\nتطبيق أحدث تفضيلات الجودة والأداء") { refreshRemote() }
        val clearAuto = actionButton("استعادة توازن الأداء\nالرجوع لإعدادات العرض المناسبة للجهاز") {
            CommercialRuntime.clearAutomaticSafeMode(this)
            render()
        }
        val back = actionButton("رجوع") { finish() }
        listOf(imageButton, safeButton, refresh, clearAuto, back).forEach { button ->
            page.addView(button, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            setBackgroundColor(CinemaStyle.Background)
            addView(page)
        })
        render()
        imageButton.requestFocus()
    }

    private fun cycleImageMode() {
        val current = prefs.getString("image_quality", "balanced") ?: "balanced"
        val next = when (current) {
            "economy" -> "balanced"
            "balanced" -> "high"
            else -> "economy"
        }
        prefs.edit().putString("image_quality", next).apply()
        render()
    }

    private fun toggleSafeMode() {
        val current = getSharedPreferences("blofy_commercial_runtime", MODE_PRIVATE)
            .getBoolean("user_safe_mode", false)
        CommercialRuntime.setUserSafeMode(this, !current)
        render()
    }

    private fun refreshRemote() {
        status.text = "جاري تحديث نمط العرض..."
        lifecycleScope.launch {
            CommercialConfigRepository.refresh(this@CommercialSettingsActivity, force = true)
            render()
        }
    }

    private fun render() {
        val snapshot = CommercialRuntime.snapshot(this)
        val image = when (snapshot.imageMode) {
            CommercialRuntime.ImageMode.ECONOMY -> "اقتصادي"
            CommercialRuntime.ImageMode.BALANCED -> "متوازن"
            CommercialRuntime.ImageMode.HIGH -> "عالي الجودة"
        }
        imageButton.bind("جودة البوسترات والخلفيات", image, "اختر توازنًا مناسبًا لسرعة الجهاز والإنترنت", cycle = true)
        val userSafe = getSharedPreferences("blofy_commercial_runtime", MODE_PRIVATE)
            .getBoolean("user_safe_mode", false)
        safeButton.bind("سلاسة الواجهة", if (userSafe) "خفيفة" else "تلقائية", "تقليل المؤثرات على الأجهزة الأضعف عند الحاجة", cycle = true)
        status.text = buildString {
            append(if (snapshot.safeMode) "تم تفعيل عرض أخف لزيادة السلاسة" else "تجربة العرض الكاملة تعمل الآن")
            append("\nجودة الفيديو تعتمد على المحتوى نفسه، وهذه الخيارات تخص شكل الواجهة.")
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = SettingCard(this).apply {
        val parts = label.split('\n', limit = 2)
        bind(parts.first(), parts.getOrElse(1) { "" })
        setOnClickListener { action() }
    }

    private fun card(focused: Boolean) = CinemaStyle.surface(this, focused, radiusDp = 14)

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
