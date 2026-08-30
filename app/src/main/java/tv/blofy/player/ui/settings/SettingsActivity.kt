package tv.blofy.player.ui.settings

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.playlist.ProviderManagerActivity

class SettingsActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var status: TextView
    private lateinit var redirectsButton: Button
    private lateinit var themeButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val theme = ThemeManager.current(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(56, 40, 56, 40)
            setBackgroundColor(theme.background)
        }
        root.addView(TextView(this).apply {
            text = "إعدادات BLOFY"
            textSize = 31f
            setTextColor(Color.WHITE)
        })
        root.addView(TextView(this).apply {
            text = "إعدادات المزود مستقلة حتى لا يؤثر سيرفر على الآخر"
            textSize = 14f
            setTextColor(theme.accent)
            setPadding(0, 6, 0, 12)
        })
        status = TextView(this).apply {
            setTextColor(Color.rgb(205, 190, 230))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 20)
        }
        root.addView(status)

        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val ts = actionButton("Live: MPEG-TS") { updateProvider { copy(liveFormat = "ts") } }
        val hls = actionButton("Live: HLS") { updateProvider { copy(liveFormat = "m3u8") } }
        val cronet = actionButton("Cronet أولاً") { updateProvider { copy(preferredTransport = "cronet") } }
        val http = actionButton("HTTP أولاً") { updateProvider { copy(preferredTransport = "http") } }
        listOf(ts, hls, cronet, http).forEach { row1.addView(it, LinearLayout.LayoutParams(220, 76).apply { marginEnd = 12 }) }
        root.addView(row1)

        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 14, 0, 0)
        }
        redirectsButton = actionButton("Redirects") {
            updateProvider { copy(allowCrossProtocolRedirects = !allowCrossProtocolRedirects) }
        }
        val refresh = actionButton("تحديث القائمة الآن") { refreshLibrary() }
        val playlists = actionButton("إدارة القوائم") {
            startActivity(Intent(this, ProviderManagerActivity::class.java))
        }
        row2.addView(redirectsButton, LinearLayout.LayoutParams(250, 76).apply { marginEnd = 12 })
        row2.addView(refresh, LinearLayout.LayoutParams(260, 76).apply { marginEnd = 12 })
        row2.addView(playlists, LinearLayout.LayoutParams(280, 76))
        root.addView(row2)

        val row3 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 14, 0, 0)
        }
        themeButton = actionButton("الثيم: ${theme.id.uppercase()}") {
            val next = ThemeManager.toggle(this)
            themeButton.text = "الثيم: ${next.id.uppercase()}"
            recreate()
        }
        row3.addView(themeButton, LinearLayout.LayoutParams(260, 76))
        root.addView(row3)

        setContentView(root)
        ts.requestFocus()

        lifecycleScope.launch {
            provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull() ?: run {
                status.text = "لا توجد قائمة تشغيل"
                return@launch
            }
            refreshStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch {
            val active = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
            if (active != null) {
                provider = active
                refreshStatus()
            }
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        isFocusable = true
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused)
            view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).setDuration(100).start()
        }
        setOnClickListener { action() }
    }

    private fun updateProvider(change: ProviderEntity.() -> ProviderEntity) {
        if (!::provider.isInitialized) return
        lifecycleScope.launch {
            provider = provider.change().copy(updatedAt = System.currentTimeMillis())
            BlofyDatabase.get(applicationContext).dao().upsertProvider(provider)
            refreshStatus()
        }
    }

    private fun refreshLibrary() {
        if (!::provider.isInitialized) return
        status.text = "جاري تحديث القنوات والأفلام والمسلسلات..."
        lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, BlofyDatabase.get(applicationContext).dao()).syncAll(provider)
                }
            }.onSuccess {
                status.text = "اكتمل التحديث  •  ${provider.name}"
            }.onFailure {
                status.text = "تعذر التحديث: ${it.message ?: "خطأ اتصال"}"
            }
        }
    }

    private fun refreshStatus() {
        status.text = "${provider.name}  •  ${provider.providerType.uppercase()}  •  ${provider.liveFormat.uppercase()}  •  ${provider.preferredTransport.uppercase()}"
        redirectsButton.text = if (provider.allowCrossProtocolRedirects) "Redirects: تشغيل" else "Redirects: إيقاف"
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        val theme = ThemeManager.current(this@SettingsActivity)
        cornerRadius = 18f
        setColor(if (focused) theme.accent else theme.surface)
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else theme.accent)
    }
}
