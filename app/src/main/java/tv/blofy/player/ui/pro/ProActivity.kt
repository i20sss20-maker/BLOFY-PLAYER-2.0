package tv.blofy.player.ui.pro

import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.pro.ProAccessPolicy
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Read-only preview of future app features. No purchase UI or entitlement claims
 * until Play Billing, verification and restore flows are implemented.
 */
class ProActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val phone = DeviceClass.detect(this) == DeviceClass.Kind.PHONE
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@ProActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(if (phone) 20 else 60), dp(if (phone) 28 else 46), dp(if (phone) 20 else 60), dp(30))
        }
        scroll.addView(root)
        root.addView(TextView(this).apply {
            text = "BLOFY PRO"
            textSize = if (phone) 30f else 40f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = if (ProAccessPolicy.currentSnapshot().isAppPro) "BLOFY PRO" else "باقتك الحالية: BLOFY FREE"
            textSize = if (phone) 15f else 18f
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(6))
        })
        root.addView(TextView(this).apply {
            text = "قريبًا — مزايا إضافية لتجربة المشاهدة"
            textSize = if (phone) 17f else 22f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(18))
        })
        val features = listOf(
            "قوائم تشغيل متعددة",
            "مزامنة المفضلة بين الأجهزة",
            "النسخ الاحتياطي للإعدادات",
            "تخصيص الواجهة",
            "تنظيم المكتبة بشكل أذكى"
        )
        features.forEach { feature ->
            root.addView(TextView(this).apply {
                text = "✦  $feature"
                textSize = if (phone) 16f else 19f
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                background = BlofyTvDesign.elevatedSurface(dp(15).toFloat())
                setPadding(dp(22), dp(14), dp(22), dp(14))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (phone) 60 else 70)).apply {
                bottomMargin = dp(9)
            })
        }
        root.addView(TextView(this).apply {
            text = "هذه صفحة تعريفية فقط. الاشتراك والشراء غير متاحين بعد. استخدام مشغل BLOFY المجاني لا يتطلب اشتراك PRO. لا يتضمن PRO مصادر محتوى أو قنوات."
            textSize = if (phone) 13f else 15f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(16), dp(8), dp(16))
        })
        root.addView(Button(this).apply {
            text = "العودة إلى التطبيق"
            isAllCaps = false
            textSize = 17f
            setTextColor(BlofyTvDesign.TextPrimary)
            isFocusable = true
            isFocusableInTouchMode = true
            background = BlofyTvDesign.primaryButton(dp(15).toFloat(), false)
            setOnFocusChangeListener { view, focused ->
                view.background = BlofyTvDesign.primaryButton(dp(15).toFloat(), focused)
            }
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58)).apply { topMargin = dp(12) })
        setContentView(scroll)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
