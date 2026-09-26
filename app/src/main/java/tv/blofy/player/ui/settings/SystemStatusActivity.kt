package tv.blofy.player.ui.settings

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.update.BlofyUpdateClient
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import java.text.DateFormat
import java.util.Date

class SystemStatusActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val widthDp = resources.configuration.screenWidthDp
        val compact = widthDp < 600

        val root = ScrollView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@SystemStatusActivity, R.drawable.blofy_home_background)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(
                dp(if (compact) 18 else 56),
                dp(if (compact) 24 else 42),
                dp(if (compact) 18 else 56),
                dp(if (compact) 28 else 48)
            )
        }
        root.addView(content)

        content.addView(TextView(this).apply {
            text = "حالة BLOFY PLAYER"
            BlofyTvDesign.applyHeroTitle(this)
            textSize = if (compact) 29f else 34f
            gravity = Gravity.RIGHT
        })
        content.addView(TextView(this).apply {
            text = "معلومات النسخة والجهاز والخدمات والقائمة النشطة"
            textSize = if (compact) 13.5f else 15f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(18))
        })

        fun section(title: String, initial: String): TextView {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.TOP or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setPadding(dp(if (compact) 18 else 24), dp(18), dp(if (compact) 18 else 24), dp(18))
                background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
                elevation = dp(5).toFloat()
            }
            card.addView(TextView(this).apply {
                text = title
                BlofyTvDesign.applyHeading(this)
                textSize = if (compact) 17f else 19f
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.RIGHT
                setPadding(0, 0, 0, dp(8))
            })
            val body = TextView(this).apply {
                text = initial
                textSize = if (compact) 14.5f else 16f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.RIGHT
                setLineSpacing(dp(5).toFloat(), 1.08f)
            }
            card.addView(body)
            content.addView(
                card,
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(10)
                }
            )
            return body
        }

        val appBody = section("التطبيق والجهاز", "جاري قراءة معلومات التطبيق...")
        val servicesBody = section("الخدمات والتفعيل", "جاري التحقق من الخدمات...")
        val providerBody = section("القائمة النشطة", "جاري قراءة القائمة...")
        section(
            "الخصوصية",
            "بيانات الدخول الحساسة لا تظهر هنا، ولا يتم عرض اسم المستخدم أو كلمة المرور أو الروابط التي تحتوي بيانات اعتماد."
        )

        val actions = LinearLayout(this).apply {
            orientation = if (compact) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
            clipChildren = false
        }
        fun action(label: String, intent: Intent) = Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 15f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            stateListAnimator = null
            BlofyTvDesign.installTvFocus(this, dp(18).toFloat(), 1.035f, false)
            setOnClickListener { startActivity(intent) }
        }

        val pair = action("▣  ربط الجهاز", Intent(this, LoginActivity::class.java))
        val lists = action("▤  إدارة القوائم", Intent(this, ProviderManagerActivity::class.java))
        if (compact) {
            actions.addView(pair, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { bottomMargin = dp(8) })
            actions.addView(lists, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)))
        } else {
            actions.addView(pair, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(8) })
            actions.addView(lists, LinearLayout.LayoutParams(0, dp(58), 1f))
        }
        content.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val releaseRequest = async {
                val endpoint = BuildConfig.UPDATE_BASE_URL.trim()
                if (endpoint.isBlank()) null else runCatching { BlofyUpdateClient.fetch(endpoint) }.getOrNull()
            }
            val provider = dao.providers().first().firstOrNull()
            val activation = dao.activation()
            val officialRelease = releaseRequest.await()
            val device = DeviceClass.detect(this@SystemStatusActivity)
            val activationText = when {
                activation == null -> "غير موجودة"
                activation.activated && activation.expiresAt == null -> "مفعّل • بدون تاريخ انتهاء محلي"
                activation.activated && activation.expiresAt != null -> "مفعّل • ينتهي ${formatTime(activation.expiresAt)}"
                activation.expiresAt != null && activation.expiresAt <= System.currentTimeMillis() -> "منتهي • ${formatTime(activation.expiresAt)}"
                else -> "غير مفعّل"
            }

            appBody.text = buildString {
                appendLine("النسخة: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                appendLine("البناء: ${BuildConfig.BUILD_SHA.take(12)}")
                appendLine("نوع الجهاز: ${device.name}")
                append("FFmpeg: ${if (BuildConfig.FFMPEG_EXTENSION_BUNDLED) "مدمج وجاهز" else "غير مدمج"}")
            }

            servicesBody.text = buildString {
                appendLine("خدمة التفعيل: ${if (BuildConfig.ACTIVATION_BASE_URL.isBlank()) "غير مضبوطة" else "مضبوطة"}")
                appendLine("خدمة التحديث: ${if (BuildConfig.UPDATE_BASE_URL.isBlank()) "غير مضبوطة" else if (officialRelease != null) "متصلة" else "تعذر التحقق الآن"}")
                if (officialRelease != null) {
                    val updateState = if (BlofyUpdateClient.isUpdateAvailable(BuildConfig.VERSION_CODE, officialRelease)) " • يتوفر تحديث" else " • أنت محدّث"
                    appendLine("الإصدار الرسمي: ${officialRelease.versionName} (${officialRelease.versionCode})$updateState")
                }
                appendLine("حالة التفعيل: $activationText")
                append("آخر تحقق: ${activation?.lastCheckAt?.let(::formatTime) ?: "—"}")
            }

            providerBody.text = if (provider == null) {
                "لا توجد قائمة تشغيل نشطة"
            } else {
                buildString {
                    appendLine(provider.name)
                    appendLine("النوع: ${provider.providerType.uppercase()}")
                    appendLine("صيغة البث: ${provider.liveFormat.uppercase()}")
                    appendLine("النقل: ${provider.preferredTransport.uppercase()}")
                    append("إعادة التوجيه: ${if (provider.allowCrossProtocolRedirects) "مفعّلة" else "متوقفة"}")
                }
            }
        }
    }

    private fun formatTime(value: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(value))

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
