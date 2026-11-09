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
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.pro.SubscriptionCheckoutPolicy
import tv.blofy.player.core.pro.PaymentChannel
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.pro.ProAccess
import tv.blofy.player.core.pro.PlayerPlan
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
            text = "باقات BLOFY PLAYER"
            textSize = if (tv) 40f else 32f
            gravity = Gravity.CENTER
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
        })
        column.addView(TextView(this).apply {
            text = "باقتك الحالية: " + ProAccess.verifiedPlan(ProAccess.current(), System.currentTimeMillis()).name
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
        val plans = listOf(
            Triple(PlayerPlan.FREE, "تشغيل قوائمك الشخصية والبحث والمفضلة", "مجاني دائمًا"),
            Triple(PlayerPlan.PRO, "المزايا الاحترافية القادمة وتنظيم المكتبة", "19 ريال / سنة"),
            Triple(PlayerPlan.VIP, "مزايا PRO وإضافات مرخصة عند توفرها", "49 ريال / سنة")
        )
        plans.forEach { (plan, description, price) ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(20), dp(14), dp(20), dp(14))
                background = BlofyTvDesign.elevatedSurface(dp(18).toFloat(), emphasis = plan == PlayerPlan.VIP)
            }
            card.addView(TextView(this).apply {
                text = "BLOFY ${plan.name}   •   $price"
                textSize = if (tv) 21f else 18f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(if (plan == PlayerPlan.VIP) BlofyTvDesign.PurpleBright else BlofyTvDesign.TextPrimary)
                gravity = Gravity.RIGHT
            })
            card.addView(TextView(this).apply {
                text = description
                textSize = if (tv) 16f else 14f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.RIGHT
                setPadding(0, dp(8), 0, 0)
            })
            column.addView(card, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) })
        }
        val paymentChannel = SubscriptionCheckoutPolicy.channel(BuildConfig.IS_GOOGLE_PLAY)
        column.addView(TextView(this).apply {
            text = when (paymentChannel) {
                PaymentChannel.GOOGLE_PLAY -> "نسخة Google Play • الاشتراكات ستكون عبر Google Play فقط"
                PaymentChannel.BLOFY_WEBSITE -> "نسخة BLOFY الخارجية • الاشتراكات ستكون عبر بوابة BLOFY الآمنة"
            }
            textSize = if (tv) 17f else 14f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.PurpleBright)
            setPadding(dp(8), dp(12), dp(8), dp(6))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        column.addView(TextView(this).apply {
            text = "الشراء غير متاح حاليًا حتى اكتمال ربط الدفع والتحقق من الاشتراكات."
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(dp(8), 0, dp(8), dp(4))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        column.addView(TextView(this).apply {
            text = "الأسعار السنوية المعروضة هي أسعار مقترحة ولم تُفعّل في Google Play. لا يوجد زر شراء حتى يكتمل التحقق الآمن من الاشتراكات. باقة VIP لا تتضمن محتوى إلا عند توفر حقوق توزيعه، ولا تتغير اشتراكات BLOFY الحالية."
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
