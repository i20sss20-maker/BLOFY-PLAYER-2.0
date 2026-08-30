package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var theme: ThemeProfile

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(54, 36, 54, 36)
            setBackgroundColor(theme.background)
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
            setTextColor(theme.accent)
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 16)
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
            setPadding(0, 6, 0, 8)
        }
        val qr = ImageView(this).apply {
            contentDescription = "رمز تفعيل BLOFY"
            setBackgroundColor(Color.WHITE)
            setPadding(10, 10, 10, 10)
        }
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(theme.accent)
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 16)
        }
        root.addView(device)
        root.addView(code)
        root.addView(qr, LinearLayout.LayoutParams(220, 220))
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
        root.addView(addPlaylist, LinearLayout.LayoutParams(420, 74))
        root.addView(connect, LinearLayout.LayoutParams(420, 74).apply { topMargin = 10 })
        setContentView(root)
        addPlaylist.requestFocus()

        lifecycleScope.launch {
            val identity = withContext(Dispatchers.IO) {
                ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
            }
            device.text = identity.deviceId
            code.text = identity.activationCode
            qr.setImageBitmap(createQr("BLOFY://activate/${identity.deviceId}?code=${identity.activationCode}"))
            refreshProviderStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) lifecycleScope.launch { refreshProviderStatus() }
    }

    private suspend fun refreshProviderStatus() {
        val provider = BlofyDatabase.get(applicationContext).dao().providers().first().firstOrNull()
        status.text = if (provider == null) "لا توجد قائمة محفوظة" else "القائمة النشطة: ${provider.name}"
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 360, 360)
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.RGB_565).apply {
            for (y in 0 until matrix.height) {
                for (x in 0 until matrix.width) {
                    setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
                }
            }
        }
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
            view.animate().scaleX(if (focused) theme.focusScale else 1f).scaleY(if (focused) theme.focusScale else 1f).setDuration(theme.motionMs).start()
        }
        setOnClickListener { action() }
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 20f
        setColor(if (focused) theme.accent else theme.surface)
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else theme.accent)
    }
}
