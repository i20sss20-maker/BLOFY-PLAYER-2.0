package tv.blofy.player.ui.pro

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
import tv.blofy.player.core.pro.ProAccess
import tv.blofy.player.ui.common.BlofyTvDesign

/** App-only PRO preview: no billing or fake activation; legacy subscriptions stay unchanged. */
class ProPreviewActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tv = DeviceClass.isTv(this)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            background = AppCompatResources.getDrawable(this@ProPreviewActivity, R.drawable.blofy_home_background)
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(if (tv) 56 else 20), dp(28), dp(if (tv) 56 else 20), dp(28))
        }
        scroll.addView(column)
        column.addView(TextView(this).apply {
            text = "BLOFY PRO"
            textSize = if (tv) 40f else 32f
            gravity = Gravity.CENTER
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
        })
        column.addView(TextView(this).apply {
            text = if (ProAccess.current().verifiedByServer) "PRO" else "BLOFY FREE • مجاني"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.Mint)
            setPadding(0, dp(8), 0, dp(14))
        })
        column.addView(TextView(this).apply {
            text = "استمتع بتشغيل قوائم Xtream وM3U الخاصة بك دون اشتراك في التطبيق."
            textSize = if (tv) 20f else 16f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextPrimary)
            setPadding(0, dp(8), 0, dp(18))
        })
        val features = listOf(
            "✦  قوائم تشغيل متعددة",
            "✦  مزامنة المفضلة بين الأجهزة",
            "✦  نسخ احتياطي سحابي",
            "✦  تخصيص متقدم للواجهة",
            "✦  مكتبة ذكية"
        )
        features.forEach { item ->
            column.addView(TextView(this).apply {
                text = item
                textSize = if (tv) 19f else 16f
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                setPadding(dp(18), dp(12), dp(18), dp(12))
                background = BlofyTvDesign.elevatedSurface(dp(18).toFloat())
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(if (tv) 66 else 58)).apply {
                bottomMargin = dp(8)
            })
        }
        column.addView(TextView(this).apply {
            text = "المزايا الاحترافية قيد التطوير. لا يتوفر شراء أو اشتراك PRO الآن. هذه الباقة لا تتضمن قنوات أو أفلامًا أو مصادر محتوى، ولا تغيّر تفعيل BLOFY الحالي."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(14), 0, dp(14))
        })
        column.addView(Button(this).apply {
            text = "العودة"
            textSize = 17f
            isAllCaps = false
            isFocusable = true
            isFocusableInTouchMode = true
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.primaryButton(dp(16).toFloat(), false)
            setOnFocusChangeListener { v, focus ->
                v.background = BlofyTvDesign.primaryButton(dp(16).toFloat(), focus)
            }
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)))
        setContentView(scroll)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
