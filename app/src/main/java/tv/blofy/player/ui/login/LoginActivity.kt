package tv.blofy.player.ui.login

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
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(54, 48, 54, 48)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 36f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "فعّل جهازك ثم أضف قائمة التشغيل"
            textSize = 16f
            setTextColor(Color.rgb(185, 140, 255))
            gravity = Gravity.CENTER
            setPadding(0, 10, 0, 26)
        })

        val device = TextView(this).apply {
            text = "جاري إنشاء هوية الجهاز..."
            textSize = 17f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
        }
        val code = TextView(this).apply {
            textSize = 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 14)
        }
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(190, 165, 225))
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 22)
        }
        root.addView(device)
        root.addView(code)
        root.addView(status)

        val addPlaylist = actionButton("إضافة قائمة التشغيل") {
            startActivity(Intent(this, PlaylistActivity::class.java))
        }
        val connect = actionButton("اتصال") {
            lifecycleScope.launch {
                val hasProvider = BlofyDatabase.get(applicationContext).dao().providers().first().isNotEmpty()
                if (hasProvider) {
                    startActivity(Intent(this@LoginActivity, HomeActivity::class.java))
                } else {
                    status.text = "أضف قائمة تشغيل أولاً"
                    addPlaylist.requestFocus()
                }
            }
        }
        root.addView(addPlaylist, LinearLayout.LayoutParams(420, 78))
        root.addView(connect, LinearLayout.LayoutParams(420, 78).apply { topMargin = 12 })
        setContentView(root)
        addPlaylist.requestFocus()

        lifecycleScope.launch {
            val identity = withContext(Dispatchers.IO) {
                ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
            }
            device.text = identity.deviceId
            code.text = identity.activationCode
            refreshProviderStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) lifecycleScope.launch { refreshProviderStatus() }
    }

    private suspend fun refreshProviderStatus() {
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "لا توجد قائمة محفوظة" else "القائمة المحفوظة: ${provider.name}"
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        isFocusable = true
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused)
            view.animate().scaleX(if (focused) 1.04f else 1f).scaleY(if (focused) 1.04f else 1f).setDuration(100).start()
        }
        setOnClickListener { action() }
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 20f
        setColor(if (focused) Color.rgb(73, 34, 122) else Color.rgb(20, 17, 31))
        setStroke(if (focused) 3 else 1, if (focused) Color.rgb(190, 135, 255) else Color.rgb(50, 42, 66))
    }
}
