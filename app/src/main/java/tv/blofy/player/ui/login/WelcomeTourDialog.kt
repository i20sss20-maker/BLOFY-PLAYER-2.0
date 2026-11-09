package tv.blofy.player.ui.login

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import tv.blofy.player.core.device.DeviceClass

/** Optional, D-pad friendly welcome tour above the existing QR pairing screen. */
internal object WelcomeTourDialog {
    private const val PREFS = "blofy_welcome_tour"
    private const val SEEN = "intro_v1_seen"
    private data class Page(val icon: String, val title: String, val detail: String)

    fun showOnce(activity: AppCompatActivity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(SEEN, false) || activity.isFinishing || activity.isDestroyed) return
        // Never require the customer to repeat the tour after returning to login.
        prefs.edit().putBoolean(SEEN, true).apply()
        show(activity)
    }

    fun show(activity: AppCompatActivity) {
        if (activity.isFinishing || activity.isDestroyed) return
        val tv = DeviceClass.isTv(activity)
        val ar = activity.resources.configuration.locales.get(0).language == "ar"
        val pages = if (ar) listOf(
            Page("✦", "أهلًا بك في BLOFY", "تجربة مشاهدة أنيقة وسهلة على الجوال والتلفزيون. تقدر تتخطى العرض وتبدأ فورًا."),
            Page("▣", "اربط جهازك بسهولة", "امسح QR أو استخدم رمز الربط الظاهر على شاشة الباركود. العرض اختياري تمامًا."),
            Page("▶", "مكتبتك، بطريقتك", "أضف قوائم Xtream وM3U الخاصة بك، وتصفح القنوات والأفلام والمسلسلات والمفضلة."),
            Page("♛", "FREE · PRO · VIP", "FREE مجاني. PRO بسعر 19 ريالًا سنويًا وVIP بسعر 49 ريالًا سنويًا ضمن الخطة القادمة؛ الدفع غير متاح حاليًا.")
        ) else listOf(
            Page("✦", "Welcome to BLOFY", "Premium viewing across your TV and phone. Skip this tour and start right away."),
            Page("▣", "Pair your device", "Scan the QR or use the pairing code on the login screen. This tour is always optional."),
            Page("▶", "Your library, your way", "Add your own Xtream or M3U playlists and browse live TV, movies, series and favorites."),
            Page("♛", "FREE · PRO · VIP", "FREE is free. Planned annual PRO is SAR 19 and VIP is SAR 49; paid checkout is not available yet.")
        )
        val dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setCancelable(true)
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = if (ar) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
            setPadding(activity.dp(24), activity.dp(22), activity.dp(24), activity.dp(20))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(
                0xFF3C2552.toInt(), 0xFF21172F.toInt(), 0xFF10121E.toInt()
            )).apply { cornerRadius = activity.dp(23).toFloat(); setStroke(activity.dp(1), 0xFF8356AE.toInt()) }
        }
        fun label(size: Float, color: Int) = TextView(activity).apply {
            textSize = size
            setTextColor(color)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }
        val eyebrow = label(13f, 0xFFC9A9FF.toInt()).apply {
            text = if (ar) "اكتشف BLOFY" else "DISCOVER BLOFY"
            letterSpacing = .08f
        }
        val symbol = label(if (tv) 48f else 42f, Color.WHITE).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(
                0xFF7048A5.toInt(), 0xFF3C2953.toInt()
            )).apply { cornerRadius = activity.dp(18).toFloat() }
        }
        val title = label(if (tv) 28f else 23f, Color.WHITE).apply { maxLines = 2 }
        val detail = label(if (tv) 18f else 16f, 0xFFE4DCEC.toInt()).apply {
            setLineSpacing(activity.dp(4).toFloat(), 1f)
        }
        val progress = label(13f, 0xFFC9A9FF.toInt())
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(eyebrow, LinearLayout.LayoutParams(-1, activity.dp(24)))
            addView(symbol, LinearLayout.LayoutParams(activity.dp(98), activity.dp(98)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = activity.dp(12)
            })
            addView(title, LinearLayout.LayoutParams(-1, -2).apply { topMargin = activity.dp(19) })
            addView(detail, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = activity.dp(14)
                bottomMargin = activity.dp(18)
            })
            addView(progress, LinearLayout.LayoutParams(-1, activity.dp(25)))
        }
        val scroll = ScrollView(activity).apply {
            isVerticalScrollBarEnabled = false
            addView(body, android.widget.FrameLayout.LayoutParams(-1, -2))
        }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        var pageIndex = 0
        lateinit var render: () -> Unit
        fun button(value: String, primary: Boolean, click: () -> Unit) = Button(activity).apply {
            text = value
            textSize = if (tv) 16f else 14f
            isAllCaps = false
            setTextColor(Color.WHITE)
            isFocusable = true
            background = GradientDrawable().apply {
                cornerRadius = activity.dp(13).toFloat()
                setColor(if (primary) 0xFF7443BB.toInt() else 0xFF342641.toInt())
                setStroke(activity.dp(1), 0xFF9471B8.toInt())
            }
            setOnClickListener { click() }
            setOnFocusChangeListener { view, focused ->
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.04f else 1f)
                    .scaleY(if (focused) 1.04f else 1f).setDuration(120).start()
            }
        }
        val skip = button(if (ar) "تخطي" else "Skip", false) { dialog.dismiss() }
        val back = button(if (ar) "السابق" else "Back", false) { if (pageIndex > 0) { pageIndex--; render() } }
        val next = button(if (ar) "التالي" else "Next", true) {
            if (pageIndex == pages.lastIndex) dialog.dismiss() else { pageIndex++; render() }
        }
        actions.addView(skip, LinearLayout.LayoutParams(0, activity.dp(52), 1f))
        actions.addView(back, LinearLayout.LayoutParams(0, activity.dp(52), 1f).apply { marginStart = activity.dp(8) })
        actions.addView(next, LinearLayout.LayoutParams(0, activity.dp(52), 1.25f).apply { marginStart = activity.dp(8) })
        root.addView(actions, LinearLayout.LayoutParams(-1, activity.dp(52)).apply { topMargin = activity.dp(10) })
        render = {
            val p = pages[pageIndex]
            symbol.text = p.icon
            title.text = p.title
            detail.text = p.detail
            progress.text = "${pageIndex + 1} / ${pages.size}   " + "●".repeat(pageIndex + 1) + "○".repeat(pages.lastIndex - pageIndex)
            back.visibility = if (pageIndex == 0) View.INVISIBLE else View.VISIBLE
            next.text = if (pageIndex == pages.lastIndex) {
                if (ar) "ابدأ الآن" else "Get started"
            } else if (ar) "التالي" else "Next"
            scroll.scrollTo(0, 0)
        }
        dialog.setContentView(root)
        dialog.show()
        val availableWidth = activity.resources.displayMetrics.widthPixels - activity.dp(32)
        val availableHeight = activity.resources.displayMetrics.heightPixels - activity.dp(32)
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setDimAmount(.72f)
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setLayout(
                (if (tv) activity.dp(650) else activity.resources.displayMetrics.widthPixels - activity.dp(28))
                    .coerceAtMost(availableWidth),
                (if (tv) activity.dp(430) else activity.dp(450)).coerceAtMost(availableHeight)
            )
            setGravity(Gravity.CENTER)
        }
        render()
        next.requestFocus()
    }

    private fun Context.dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
