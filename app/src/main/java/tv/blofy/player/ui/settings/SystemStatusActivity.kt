package tv.blofy.player.ui.settings

import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import java.text.DateFormat
import java.util.Date

class SystemStatusActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = ScrollView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@SystemStatusActivity, R.drawable.blofy_home_background)
            isFillViewport = true
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(56), dp(42), dp(56), dp(48))
        }
        root.addView(content)

        content.addView(TextView(this).apply {
            text = "حالة BLOFY PLAYER"
            BlofyTvDesign.applyHeroTitle(this)
            textSize = 34f
            gravity = Gravity.RIGHT
        })
        content.addView(TextView(this).apply {
            text = "معلومات النسخة والجهاز والقائمة النشطة"
            textSize = 15f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(24))
        })

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(26), dp(22), dp(26), dp(22))
            background = BlofyTvDesign.elevatedSurface(dp(24).toFloat())
            elevation = dp(8).toFloat()
        }
        val body = TextView(this).apply {
            text = "جاري قراءة الحالة..."
            textSize = 16.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            setLineSpacing(dp(7).toFloat(), 1.04f)
        }
        card.addView(body)
        content.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull()
            val activation = dao.activation()
            val device = DeviceClass.detect(this@SystemStatusActivity)
            val activationText = when {
                activation == null -> "غير موجودة"
                activation.activated && activation.expiresAt == null -> "مفعّل • بدون تاريخ انتهاء محلي"
                activation.activated && activation.expiresAt != null -> "مفعّل • ينتهي ${formatTime(activation.expiresAt)}"
                activation.expiresAt != null && activation.expiresAt <= System.currentTimeMillis() -> "منتهي • ${formatTime(activation.expiresAt)}"
                else -> "غير مفعّل"
            }
            body.text = buildString {
                appendLine("النسخة: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                appendLine("البناء: ${BuildConfig.BUILD_SHA.take(12)}")
                appendLine("نوع الجهاز: ${device.name}")
                appendLine("FFmpeg: ${if (BuildConfig.FFMPEG_EXTENSION_BUNDLED) "مدمج وجاهز" else "غير مدمج"}")
                appendLine("خدمة التفعيل: ${if (BuildConfig.ACTIVATION_BASE_URL.isBlank()) "غير مضبوطة" else "متصلة"}")
                appendLine("حالة التفعيل: $activationText")
                appendLine("آخر تحقق: ${activation?.lastCheckAt?.let(::formatTime) ?: "—"}")
                appendLine()
                if (provider == null) {
                    appendLine("القائمة النشطة: لا توجد قائمة")
                } else {
                    appendLine("القائمة النشطة: ${provider.name}")
                    appendLine("النوع: ${provider.providerType.uppercase()}")
                    appendLine("صيغة البث: ${provider.liveFormat.uppercase()}")
                    appendLine("النقل: ${provider.preferredTransport.uppercase()}")
                    appendLine("إعادة التوجيه: ${if (provider.allowCrossProtocolRedirects) "مفعّلة" else "متوقفة"}")
                }
                appendLine()
                append("لا يتم عرض اسم المستخدم أو كلمة المرور أو أي رابط يحتوي بيانات دخول في هذه الشاشة.")
            }
        }
    }

    private fun formatTime(value: Long): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(value))
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
