package tv.blofy.player.ui.subscription

import android.os.Bundle
import android.view.Gravity
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.diagnostics.SubscriptionHealth
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import java.text.DateFormat
import java.util.Date

class ConnectionStatusActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            setBackgroundColor(CinemaStyle.Background)
        }
        val scroll = ScrollView(this).apply { addView(content); isFillViewport = true }
        setContentView(scroll)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom); insets
        }
        fun label(text: String, heading: Boolean = false) = TextView(this).apply {
            this.text = text
            textSize = if (heading) 24f else 14f
            typeface = if (heading) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
            setTextColor(if (heading) CinemaStyle.White else BlofyTvDesign.TextSecondary)
            setPadding(0, dp(8), 0, dp(12))
        }
        content.addView(label("اشتراكي وفحص الاتصال", true))
        content.addView(label("تفعيل BLOFY يخص التطبيق. صلاحية القنوات والأفلام تتبع اشتراك البث الخاص بكل قائمة."))
        val activation = label("جارٍ قراءة تفعيل التطبيق…").also(content::addView)
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val check = Button(this).apply { text = "فحص اشتراكات البث"; CinemaStyle.styleButton(this, true) }
        content.addView(check, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(12) })
        content.addView(results)
        content.addView(label("الفحص يقرأ حالة الحساب فقط. لا يشغّل بثًا إضافيًا، ولا يعرض رابط الهوست أو كلمة المرور."))
        content.addView(Switch(this).apply {
            text = "الوضع الخفيف • تقليل مؤثرات الواجهة"
            isChecked = DeviceClass.lightModeEnabled(this@ConnectionStatusActivity)
            setPadding(0, dp(16), 0, dp(16))
            setOnCheckedChangeListener { _, enabled -> DeviceClass.setLightMode(this@ConnectionStatusActivity, enabled) }
        }, LinearLayout.LayoutParams(-1, -2))
        check.setOnClickListener {
            check.isEnabled = false
            results.removeAllViews()
            lifecycleScope.launch {
                try {
                    val providers = BlofyDatabase.get(applicationContext).dao().providers().first()
                    if (providers.isEmpty()) results.addView(label("أضف قائمة أولًا لعرض حالة اشتراكها."))
                    for (provider in providers) {
                        val row = label("${provider.name}\nجارٍ الفحص…")
                        row.background = CinemaStyle.surface(this@ConnectionStatusActivity)
                        row.setPadding(dp(16), dp(16), dp(16), dp(16))
                        results.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
                        val result = SubscriptionHealth.check(provider)
                        row.text = buildString {
                            append(provider.name).append("\n").append(message(result.state))
                            result.expiresAt?.let { append("\nانتهاء اشتراك البث: ").append(DateFormat.getDateTimeInstance().format(Date(it))) }
                            if (result.connections != null && result.limit != null) append("\nالاتصالات المستخدمة: ${result.connections} من ${result.limit}")
                        }
                    }
                } finally { check.isEnabled = true }
            }
        }
        lifecycleScope.launch {
            val state = BlofyDatabase.get(applicationContext).dao().activation()
            activation.text = "تفعيل التطبيق: " + when {
                state == null -> "لم تتم قراءته بعد"
                state.activated -> "مفعّل"
                else -> "غير مفعّل"
            }
        }
    }

    private fun message(state: SubscriptionHealth.State) = when (state) {
        SubscriptionHealth.State.ACTIVE -> "الاشتراك ساري والمصدر يستجيب. جاهزية الحساب لا تضمن توفر كل قناة."
        SubscriptionHealth.State.EXPIRED -> "انتهى اشتراك البث • يحتاج تجديدًا من البائع."
        SubscriptionHealth.State.BLOCKED -> "حساب البث موقوف • راجع البائع."
        SubscriptionHealth.State.INVALID -> "المصدر رفض بيانات الحساب • راجع بيانات القائمة."
        SubscriptionHealth.State.CONNECTION_LIMIT -> "الاشتراك ساري، وجميع الاتصالات مستخدمة. قد يكون منها التشغيل الحالي على هذا الجهاز."
        SubscriptionHealth.State.DNS -> "تعذر الوصول إلى عنوان المصدر • تحقق من الشبكة وDNS."
        SubscriptionHealth.State.TIMEOUT -> "المصدر تأخر في الرد • أعد الفحص بعد قليل."
        SubscriptionHealth.State.UNREACHABLE -> "المصدر لا يستجيب حاليًا • تحقق من الشبكة وحالة الخدمة."
        SubscriptionHealth.State.UNKNOWN -> "وصل رد من المصدر، لكنه لا يحتوي حالة حساب واضحة."
        SubscriptionHealth.State.UNSUPPORTED -> "قوائم M3U لا توفر بيانات صلاحية الحساب بهذا الفحص."
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
