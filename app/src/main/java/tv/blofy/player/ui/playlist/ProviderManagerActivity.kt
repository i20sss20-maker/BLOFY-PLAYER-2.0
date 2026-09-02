package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient

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
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            setPadding(52, 36, 52, 36)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "إدارة قوائم التشغيل"
            textSize = 31f
            gravity = Gravity.RIGHT
            setTextColor(Color.WHITE)
        })
        status = TextView(this).apply {
            text = "اختر طريقة الدخول أو إدارة القوائم المحفوظة"
            textSize = 15f
            gravity = Gravity.RIGHT
            setTextColor(Color.rgb(185, 140, 255))
            setPadding(0, 6, 0, 18)
        }
        root.addView(status)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.RIGHT
        }
        val subscriberButton = actionButton("subscriber", "مشتركين BLOFY") {
            startActivity(Intent(this, BlofySubscriberActivity::class.java))
        }
        addButton = actionButton("add", "+ Xtream / M3U") {
            startActivity(Intent(this, PlaylistActivity::class.java).putExtra(PlaylistActivity.EXTRA_DIRECT_FORM, true))
        }
        actions.addView(subscriberButton, LinearLayout.LayoutParams(300, 76).apply { marginStart = 14 })
        actions.addView(addButton, LinearLayout.LayoutParams(280, 76))
        root.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 76).apply { bottomMargin = 20; gravity = Gravity.RIGHT })

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL }
        val scroll = ScrollView(this).apply { addView(list) }
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
                text = "لا توجد قوائم محفوظة • اختر مشتركين BLOFY أو أضف Xtream / M3U"
                setTextColor(Color.LTGRAY)
                textSize = 18f
                gravity = Gravity.RIGHT
                setPadding(0, 20, 0, 0)
            })
            restoreFocus()
            return
        }
        items.forEach { provider ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = android.view.View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(18, 12, 18, 12)
                background = panel(provider.enabled)
            }
            row.addView(TextView(this).apply {
                text = buildString {
                    append(if (provider.enabled) "● " else "○ ")
                    append(provider.name)
                    append("  •  ")
                    append(if (provider.name == "مشتركين BLOFY") "BLOFY" else provider.providerType.uppercase())
                }
                textSize = 17f
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                setTextColor(Color.WHITE)
            }, LinearLayout.LayoutParams(0, 68, 1f))

            row.addView(actionButton("${provider.id}:select", if (provider.enabled) "نشطة" else "اختيار") { activate(provider) }, LinearLayout.LayoutParams(135, 62).apply { marginStart = 8 })
            row.addView(actionButton("${provider.id}:edit", "تعديل") { edit(provider) }, LinearLayout.LayoutParams(135, 62).apply { marginStart = 8 })
            row.addView(actionButton("${provider.id}:refresh", "تحديث") { refresh(provider) }, LinearLayout.LayoutParams(135, 62).apply { marginStart = 8 })
            row.addView(actionButton("${provider.id}:delete", "حذف") { remove(provider) }, LinearLayout.LayoutParams(120, 62))
            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 92).apply { bottomMargin = 10 })
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

    private fun actionButton(key: String, label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 14.5f
        setTextColor(Color.WHITE)
        isFocusable = true
        isFocusableInTouchMode = true
        background = button(false)
        setOnFocusChangeListener { view, focused ->
            view.background = button(focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).translationZ(if (focused) 14f else 2f).setDuration(100).start()
            if (focused && isTv) FocusMemory.save(this@ProviderManagerActivity, SCREEN_KEY, key)
        }
        setOnClickListener { action() }
        focusButtons[key] = this
    }

    private fun button(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 18f
        setColor(if (focused) Color.rgb(92, 39, 153) else Color.rgb(24, 20, 34))
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else Color.rgb(58, 48, 74))
    }

    private fun panel(active: Boolean) = GradientDrawable().apply {
        cornerRadius = 20f
        setColor(if (active) Color.rgb(28, 20, 44) else Color.rgb(13, 12, 20))
        setStroke(if (active) 2 else 1, if (active) Color.rgb(126, 44, 255) else Color.rgb(42, 36, 54))
    }

    companion object { private const val SCREEN_KEY = "provider_manager" }
}
