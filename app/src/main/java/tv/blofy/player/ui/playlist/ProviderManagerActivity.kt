package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.common.BlofyTvDesign

class ProviderManagerActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var addButton: Button
    private val focusButtons = linkedMapOf<String, Button>()
    private val isTv by lazy { DeviceClass.isTv(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(58), dp(34), dp(58), dp(34))
            background = AppCompatResources.getDrawable(this@ProviderManagerActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        root.addView(TextView(this).apply {
            text = "إدارة قوائم التشغيل"
            BlofyTvDesign.applyTitle(this)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "اختر طريقة الدخول أو بدّل بين القوائم المحفوظة"
            textSize = 16f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, 0)
        })
        status = TextView(this).apply {
            text = "مشتركين BLOFY يخفي رابط السيرفر ويحتاج اسم المستخدم وكلمة المرور فقط"
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(14).toFloat())
        }
        root.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
            topMargin = dp(14); bottomMargin = dp(18)
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
            clipChildren = false
        }
        val subscriberButton = actionButton("subscriber", "مشتركين BLOFY", primary = true) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
        }
        addButton = actionButton("add", "+  Xtream / M3U") {
            startActivity(Intent(this, PlaylistActivity::class.java).putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true))
        }
        actions.addView(subscriberButton, LinearLayout.LayoutParams(dp(310), dp(68)).apply { marginStart = dp(12) })
        actions.addView(addButton, LinearLayout.LayoutParams(dp(280), dp(68)))
        root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(72)).apply {
            bottomMargin = dp(20); gravity = Gravity.RIGHT
        })

        root.addView(TextView(this).apply {
            text = "القوائم المحفوظة"
            textSize = 20f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(8), 0, dp(12))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            BlofyDatabase.get(applicationContext).dao().allProviders().collect { render(it) }
        }
    }

    private fun render(items: List<ProviderEntity>) {
        focusButtons.keys.filter { it !in setOf("add", "subscriber") }.toList().forEach { focusButtons.remove(it) }
        list.removeAllViews()
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "ما عندك قوائم محفوظة حتى الآن\nابدأ بمشتركين BLOFY أو أضف Xtream / M3U"
                setTextColor(BlofyTvDesign.TextSecondary)
                textSize = 18f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setLineSpacing(dp(4).toFloat(), 1.12f)
                setPadding(dp(22), dp(24), dp(22), dp(24))
                background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            })
            restoreFocus()
            return
        }

        items.forEach { provider ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(20), dp(12), dp(20), dp(12))
                background = if (provider.enabled) BlofyTvDesign.surface(dp(22).toFloat(), true) else BlofyTvDesign.surface(dp(22).toFloat(), false)
                clipChildren = false
            }

            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
                layoutDirection = View.LAYOUT_DIRECTION_RTL
            }
            info.addView(TextView(this).apply {
                text = provider.name
                textSize = 18f
                typeface = Typeface.create("sans-serif", Typeface.BOLD)
                gravity = Gravity.RIGHT
                setTextColor(Color.WHITE)
            })
            info.addView(TextView(this).apply {
                text = buildString {
                    append(if (provider.enabled) "● القائمة النشطة" else "○ قائمة محفوظة")
                    append("  •  ")
                    append(if (provider.name == "مشتركين BLOFY") "BLOFY Secure" else provider.providerType.uppercase())
                }
                textSize = 13.5f
                typeface = BlofyTvDesign.BodyTypeface
                gravity = Gravity.RIGHT
                setTextColor(if (provider.enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
            })
            row.addView(info, LinearLayout.LayoutParams(0, dp(70), 1f))

            row.addView(actionButton("${provider.id}:select", if (provider.enabled) "نشطة" else "اختيار", primary = !provider.enabled) { activate(provider) }, LinearLayout.LayoutParams(dp(126), dp(58)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:edit", "تعديل") { edit(provider) }, LinearLayout.LayoutParams(dp(118), dp(58)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:refresh", "تحديث") { refresh(provider) }, LinearLayout.LayoutParams(dp(118), dp(58)).apply { marginStart = dp(8) })
            row.addView(actionButton("${provider.id}:delete", "حذف") { remove(provider) }, LinearLayout.LayoutParams(dp(110), dp(58)))
            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(96)).apply { bottomMargin = dp(10) })
        }
        restoreFocus()
    }

    private fun restoreFocus() {
        if (!isTv) return
        val key = FocusMemory.restore(this, SCREEN_KEY)
        val target = key?.let(focusButtons::get) ?: focusButtons["subscriber"] ?: addButton
        target.post { if (!isFinishing) target.requestFocus() }
    }

    private fun activate(provider: ProviderEntity) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            dao.disableAllProviders()
            dao.activateProvider(provider.id)
            status.text = "تم اختيار ${provider.name}"
        }
    }

    private fun edit(provider: ProviderEntity) {
        if (provider.name == "مشتركين BLOFY" && provider.baseUrl.contains("/api/v1/subscribers/xtream")) {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
            return
        }
        startActivity(Intent(this, PlaylistActivity::class.java).apply {
            putExtra(PlaylistActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true)
        })
    }

    private fun refresh(provider: ProviderEntity) {
        status.text = "جاري تحديث ${provider.name}..."
        lifecycleScope.launch {
            runCatching {
                PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(provider)
            }.onSuccess { status.text = "تم تحديث ${provider.name}" }
                .onFailure { status.text = "فشل التحديث: ${it.message ?: "خطأ اتصال"}" }
        }
    }

    private fun remove(provider: ProviderEntity) {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            dao.deleteProvider(provider.id)
            if (provider.enabled) {
                val next = dao.allProviders().first().firstOrNull()
                if (next != null) dao.activateProvider(next.id)
            }
            status.text = "تم حذف ${provider.name}"
        }
    }

    private fun actionButton(key: String, label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14.5f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Color.WHITE)
        stateListAnimator = null
        BlofyTvDesign.installTvFocus(this, dp(17).toFloat(), 1.04f, primary) {
            if (isTv) FocusMemory.save(this@ProviderManagerActivity, SCREEN_KEY, key)
        }
        setOnClickListener { action() }
        focusButtons[key] = this
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object { private const val SCREEN_KEY = "provider_manager" }
}
