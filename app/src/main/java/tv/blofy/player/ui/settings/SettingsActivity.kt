package tv.blofy.player.ui.settings

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity

class SettingsActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(56, 40, 56, 40)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "إعدادات BLOFY"
            textSize = 30f
            setTextColor(Color.WHITE)
        })
        status = TextView(this).apply {
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 14, 0, 20)
        }
        root.addView(status)

        val ts = Button(this).apply {
            text = "البث المباشر: MPEG-TS"
            isAllCaps = false
            setOnClickListener { updateProvider { copy(liveFormat = "ts") } }
        }
        val hls = Button(this).apply {
            text = "البث المباشر: HLS"
            isAllCaps = false
            setOnClickListener { updateProvider { copy(liveFormat = "m3u8") } }
        }
        val cronet = Button(this).apply {
            text = "النقل: Cronet أولاً"
            isAllCaps = false
            setOnClickListener { updateProvider { copy(preferredTransport = "cronet") } }
        }
        val http = Button(this).apply {
            text = "النقل: HTTP أولاً"
            isAllCaps = false
            setOnClickListener { updateProvider { copy(preferredTransport = "http") } }
        }
        listOf(ts, hls, cronet, http).forEach {
            root.addView(it, LinearLayout.LayoutParams(420, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 10 })
        }
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

    private fun updateProvider(change: ProviderEntity.() -> ProviderEntity) {
        if (!::provider.isInitialized) return
        lifecycleScope.launch {
            provider = provider.change().copy(updatedAt = System.currentTimeMillis())
            BlofyDatabase.get(applicationContext).dao().upsertProvider(provider)
            refreshStatus()
        }
    }

    private fun refreshStatus() {
        status.text = "${provider.name}  •  ${provider.liveFormat.uppercase()}  •  ${provider.preferredTransport.uppercase()}"
    }
}
