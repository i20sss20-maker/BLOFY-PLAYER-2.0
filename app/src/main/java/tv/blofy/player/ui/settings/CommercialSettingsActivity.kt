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
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.commercial.CommercialConfigRepository
import tv.blofy.player.core.commercial.CommercialRuntime

class CommercialSettingsActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var imageButton: Button
    private lateinit var safeButton: Button
    private val prefs by lazy { getSharedPreferences("blofy_player_settings", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(48), dp(36), dp(48), dp(36))
            setBackgroundColor(0xFF090711.toInt())
        }
        page.addView(TextView(this).apply {
            text = "BLOFY COMMERCIAL STABILITY"
            textSize = 12f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFB574FF.toInt())
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(-1, dp(30)))
        page.addView(TextView(this).apply {
            text = "الأداء والاستقرار"
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
        }, LinearLayout.LayoutParams(-1, dp(58)))

        status = TextView(this).apply {
            textSize = 13f
            setTextColor(0xFFD9CBE8.toInt())
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(18), 0)
            background = card(false)
        }
        page.addView(status, LinearLayout.LayoutParams(-1, dp(62)).apply { bottomMargin = dp(18) })

        imageButton = actionButton("") { cycleImageMode() }
        safeButton = actionButton("") { toggleSafeMode() }
        val refresh = actionButton("↻  تحديث إعدادات BLOFY\nFeature Flags + Rollout") { refreshRemote() }
        val clearAuto = actionButton("✓  إعادة الوضع التلقائي\nمسح Safe Mode التلقائي") {
            CommercialRuntime.clearAutomaticSafeMode(this)
            render()
        }
        val back = actionButton("↩  رجوع") { finish() }
        listOf(imageButton, safeButton, refresh, clearAuto, back).forEach { button ->
            page.addView(button, LinearLayout.LayoutParams(-1, dp(78)).apply { bottomMargin = dp(10) })
        }
        setContentView(page)
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
        status.text = "جاري تحديث إعدادات BLOFY..."
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
        imageButton.text = "▣  جودة الصور\n$image"
        val userSafe = getSharedPreferences("blofy_commercial_runtime", MODE_PRIVATE)
            .getBoolean("user_safe_mode", false)
        safeButton.text = "◈  Safe Mode\n${if (userSafe) "مفعل يدويًا" else "تلقائي حسب الجهاز"}"
        val config = CommercialConfigRepository.current(this)
        status.text = buildString {
            append(if (snapshot.safeMode) "Safe Mode نشط" else "الوضع الكامل نشط")
            snapshot.reason?.let { append(" • $it") }
            append(" • Config r${config.revision}")
            append(" • الصور: $image")
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        isFocusable = true
        background = card(false)
        setOnFocusChangeListener { view, focused ->
            view.background = card(focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).setDuration(70).start()
        }
        setOnClickListener { action() }
    }

    private fun card(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF6638A2.toInt(), 0xFF35204C.toInt())
        else intArrayOf(0xFF241831.toInt(), 0xFF17101F.toInt())
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) 0xFFC897FF.toInt() else 0xFF513A68.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
