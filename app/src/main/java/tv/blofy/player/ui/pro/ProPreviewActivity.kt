package tv.blofy.player.ui.pro

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.os.ConfigurationCompat
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.pro.PaymentChannel
import tv.blofy.player.core.pro.PlayerPlan
import tv.blofy.player.core.pro.ProAccess
import tv.blofy.player.core.pro.SubscriptionCheckoutPolicy
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * FREE / PRO / VIP discovery. Each card is a genuine TV DPAD target.
 * This screen does not sell subscriptions or grant entitlements.
 */
class ProPreviewActivity : AppCompatActivity() {
    private var arabic = false
    private var tv = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        arabic = ConfigurationCompat.getLocales(resources.configuration).get(0)?.language == "ar"
        tv = DeviceClass.isTv(this)
        val direction = if (arabic) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutDirection = direction
            isVerticalScrollBarEnabled = false
            descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS
            background = AppCompatResources.getDrawable(this@ProPreviewActivity, R.drawable.blofy_home_background)
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = direction
            setPadding(dp(if (tv) 42 else 18), dp(18), dp(if (tv) 42 else 18), dp(26))
        }
        scroll.addView(page, android.widget.FrameLayout.LayoutParams(-1, -2))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = direction
            gravity = Gravity.CENTER_VERTICAL
        }
        val back = button(if (arabic) "رجوع" else "Back").apply {
            id = View.generateViewId()
            setOnClickListener { finish() }
            tag = "blofy_pro_back"
        }
        top.addView(back, LinearLayout.LayoutParams(dp(if (tv) 128 else 100), dp(50)))
        top.addView(text("BLOFY", if (tv) 23f else 21f, BlofyTvDesign.PurpleBright, true).apply {
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(18) })
        page.addView(top)

        page.addView(text(
            if (arabic) "اختر تجربتك مع BLOFY" else "Choose your BLOFY experience",
            if (tv) 32f else 25f, BlofyTvDesign.TextPrimary, true
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(16), 0, dp(8))
        })
        val currentPlan = ProAccess.verifiedPlan(ProAccess.current(), System.currentTimeMillis())
        page.addView(text(
            (if (arabic) "باقتك الحالية: " else "Current plan: ") + currentPlan.name,
            16f, BlofyTvDesign.Mint
        ).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(12)) })
        page.addView(text(
            if (arabic) "استمتع بتشغيل قوائمك الخاصة. تصفح المزايا والخطط السنوية بالريموت أو باللمس."
            else "Play your own playlists. Explore annual plans with your remote or touch.",
            if (tv) 17f else 15f, BlofyTvDesign.TextSecondary
        ).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(17)) })

        val cards = arrayListOf<View>()
        val plans = listOf(
            PlanInfo(PlayerPlan.FREE, if (arabic) "مجاني دائمًا" else "Always free",
                if (arabic) "تشغيل قوائم Xtream وM3U والبحث والمفضلة"
                else "Your Xtream and M3U playlists, search and favorites",
                if (arabic) "مجانًا دون اشتراك في التطبيق. لا توجد مصادر محتوى مرفقة."
                else "Use the player for free; no media sources are included."),
            PlanInfo(PlayerPlan.PRO, if (arabic) "19 ريال / سنة" else "SAR 19 / year",
                if (arabic) "مزايا احترافية وتنظيم متقدم للمكتبة"
                else "Advanced player tools and library organization",
                if (arabic) "مزايا قيد التطوير. الشراء غير متاح حاليًا."
                else "Features are in development. Checkout is not available yet."),
            PlanInfo(PlayerPlan.VIP, if (arabic) "49 ريال / سنة" else "SAR 49 / year",
                if (arabic) "مزايا PRO وإضافات مرخّصة عند توفرها"
                else "PRO features plus eligible licensed extras when available",
                if (arabic) "لا يُضمّن محتوى إضافي إلا بحقوق توزيع واضحة. الشراء غير متاح الآن."
                else "Extra media requires redistribution rights. Checkout is not available yet.")
        )
        plans.forEach { info ->
            val card = LinearLayout(this).apply {
                id = View.generateViewId()
                tag = "blofy_plan_${info.plan.name.lowercase()}"
                orientation = LinearLayout.VERTICAL
                layoutDirection = direction
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(22), dp(16), dp(22), dp(17))
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = true
                background = cardBackground(info.plan, false)
                contentDescription = "BLOFY ${info.plan.name}, ${info.price}. ${info.description}"
                setOnFocusChangeListener { view, focused ->
                    view.background = cardBackground(info.plan, focused)
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.012f else 1f)
                        .scaleY(if (focused) 1.012f else 1f).setDuration(115).start()
                }
                setOnClickListener { showPlanDetails(info) }
            }
            val line = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = direction
                gravity = Gravity.CENTER_VERTICAL
            }
            line.addView(text("BLOFY ${info.plan.name}", if (tv) 22f else 19f,
                if (info.plan == PlayerPlan.VIP) BlofyTvDesign.PurpleBright else BlofyTvDesign.TextPrimary,
                true
            ), LinearLayout.LayoutParams(0, -2, 1f))
            line.addView(text(info.price, if (tv) 19f else 16f, BlofyTvDesign.Mint, true).apply {
                gravity = Gravity.END
            }, LinearLayout.LayoutParams(-2, -2))
            card.addView(line, LinearLayout.LayoutParams(-1, -2))
            card.addView(text(info.description, if (tv) 16f else 14f, BlofyTvDesign.TextSecondary).apply {
                setPadding(0, dp(9), 0, 0)
            }, LinearLayout.LayoutParams(-1, -2))
            page.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
            cards.add(card)
        }

        val channel = SubscriptionCheckoutPolicy.channel(BuildConfig.IS_GOOGLE_PLAY)
        page.addView(text(when (channel) {
            PaymentChannel.GOOGLE_PLAY ->
                if (arabic) "نسخة Google Play — الدفع لاحقًا عبر Google Play"
                else "Google Play edition — future billing via Google Play"
            PaymentChannel.BLOFY_WEBSITE ->
                if (arabic) "نسخة BLOFY الخارجية — الدفع لاحقًا عبر بوابة BLOFY"
                else "Website edition — future billing via BLOFY"
        }, if (tv) 15f else 13f, BlofyTvDesign.PurpleBright).apply {
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(12), dp(12), dp(8))
        })
        page.addView(text(
            if (arabic) "الأسعار السنوية للعرض فقط. لم يتم تفعيل الشراء أو مزايا PRO وVIP بعد، ولن تتغير اشتراكاتك الحالية."
            else "Annual prices are for preview only. Purchases and PRO/VIP features are not active; existing access is unchanged.",
            13f, BlofyTvDesign.TextMuted
        ).apply { gravity = Gravity.CENTER; setPadding(0, dp(6), 0, dp(16)) })
        val bottomBack = button(if (arabic) "العودة إلى التطبيق" else "Return to app").apply {
            id = View.generateViewId()
            tag = "blofy_pro_return"
            setOnClickListener { finish() }
        }
        page.addView(bottomBack, LinearLayout.LayoutParams(-1, dp(54)))
        // Explicit vertical navigation, including controls initially outside the viewport.
        back.nextFocusDownId = cards.first().id
        cards.forEachIndexed { index, view ->
            view.nextFocusUpId = cards.getOrNull(index - 1)?.id ?: back.id
            view.nextFocusDownId = cards.getOrNull(index + 1)?.id ?: bottomBack.id
        }
        bottomBack.nextFocusUpId = cards.last().id
        setContentView(scroll)
        back.requestFocus()
    }

    private data class PlanInfo(
        val plan: PlayerPlan,
        val price: String,
        val description: String,
        val detail: String
    )

    private fun showPlanDetails(info: PlanInfo) {
        AlertDialog.Builder(this)
            .setTitle("BLOFY ${info.plan.name}")
            .setMessage("${info.price}\n\n${info.description}\n\n${info.detail}")
            .setPositiveButton(if (arabic) "حسنًا" else "OK", null)
            .show().window?.decorView?.findFocus()
    }

    private fun cardBackground(plan: PlayerPlan, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF7042A0.toInt(), 0xFF372453.toInt())
        else if (plan == PlayerPlan.VIP) intArrayOf(0xFF38204F.toInt(), 0xFF21152F.toInt())
        else intArrayOf(0xFF2A1B3D.toInt(), 0xFF1B1428.toInt())
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(dp(if (focused) 3 else 1),
            if (focused) 0xFFE1C8FF.toInt() else 0xFF614873.toInt())
    }

    private fun button(label: String) = Button(this).apply {
        text = label
        textSize = if (tv) 17f else 15f
        isAllCaps = false
        isFocusable = true
        isFocusableInTouchMode = false
        setTextColor(Color.WHITE)
        background = BlofyTvDesign.primaryButton(dp(15).toFloat(), false)
        setOnFocusChangeListener { view, focused ->
            view.background = BlofyTvDesign.primaryButton(dp(15).toFloat(), focused)
        }
    }

    private fun text(value: String, size: Float, color: Int, heading: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            typeface = if (heading) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
            includeFontPadding = false
        }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
