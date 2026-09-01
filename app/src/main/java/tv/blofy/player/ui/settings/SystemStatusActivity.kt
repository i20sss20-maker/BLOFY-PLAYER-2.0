package tv.blofy.player.ui.settings

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.data.local.BlofyDatabase
import java.text.DateFormat
import java.util.Date

class SystemStatusActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val theme = ThemeManager.current(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(48, 38, 48, 38)
            setBackgroundColor(theme.background)
        }
        content.addView(TextView(this).apply {
            text = "BLOFY System Status"
            textSize = 30f
            setTextColor(Color.WHITE)
        })
        content.addView(TextView(this).apply {
            text = "معلومات النسخة المستخدمة في اختبار Alpha"
            textSize = 14f
            setTextColor(theme.accent)
            setPadding(0, 6, 0, 22)
        })
        val body = TextView(this).apply {
            text = "جاري قراءة الحالة..."
            textSize = 17f
            setTextColor(Color.rgb(225, 220, 235))
            setLineSpacing(10f, 1f)
        }
        content.addView(body)
        setContentView(ScrollView(this).apply { addView(content) })

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull()
            val activation = dao.activation()
            val device = DeviceClass.detect(this@SystemStatusActivity)
            val activationText = when {
                activation == null -> "غير موجودة"
                activation.activated && activation.expiresAt == null -> "مفعّل • Lifetime/بدون انتهاء محلي"
                activation.activated && activation.expiresAt != null -> "مفعّل • ينتهي ${formatTime(activation.expiresAt)}"
                activation.expiresAt != null && activation.expiresAt <= System.currentTimeMillis() -> "منتهي • ${formatTime(activation.expiresAt)}"
                else -> "غير مفعّل"
            }
            body.text = buildString {
                appendLine("App: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                appendLine("Build: ${BuildConfig.BUILD_SHA.take(12)}")
                appendLine("Device class: ${device.name}")
                appendLine("FFmpeg native: ${if (BuildConfig.FFMPEG_EXTENSION_BUNDLED) "مدمج" else "غير مدمج"}")
                appendLine("Activation endpoint: ${if (BuildConfig.ACTIVATION_BASE_URL.isBlank()) "غير مضبوط" else "مضبوط"}")
                appendLine("Activation: $activationText")
                appendLine("Last activation check: ${activation?.lastCheckAt?.let(::formatTime) ?: "—"}")
                appendLine()
                if (provider == null) {
                    appendLine("Provider: لا توجد قائمة نشطة")
                } else {
                    appendLine("Provider: ${provider.name}")
                    appendLine("Provider type: ${provider.providerType.uppercase()}")
                    appendLine("Live format: ${provider.liveFormat.uppercase()}")
                    appendLine("Transport: ${provider.preferredTransport.uppercase()}")
                    appendLine("Redirects: ${if (provider.allowCrossProtocolRedirects) "ON" else "OFF"}")
                    appendLine("External player: يدوي فقط • لا خروج تلقائي من BLOFY")
                }
                appendLine()
                appendLine("ملاحظة: هذه الشاشة لا تعرض اسم المستخدم أو كلمة المرور أو رابط يحتوي بيانات دخول.")
            }
        }
    }

    private fun formatTime(value: Long): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(value))
}
