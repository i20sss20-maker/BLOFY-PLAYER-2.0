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
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.ActivationCheckResponse
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.playlist.PlaylistActivity

class LoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private lateinit var deviceView: TextView
    private lateinit var codeView: TextView
    private lateinit var qrView: ImageView
    private lateinit var addPlaylist: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        val root = if (theme.id == "cinema" && deviceKind == DeviceClass.Kind.TV) buildCinemaTvLogin() else buildVisionLogin()
        setContentView(root)
        if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()

        lifecycleScope.launch {
            val identity = withContext(Dispatchers.IO) {
                ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao()).ensureIdentity()
            }
            deviceView.text = identity.deviceId
            codeView.text = identity.activationCode
            qrView.setImageBitmap(createQr("BLOFY://activate/${identity.deviceId}?code=${identity.activationCode}"))
            refreshProviderStatus()
        }
    }

    private fun buildVisionLogin(): LinearLayout {
        val phone = deviceKind == DeviceClass.Kind.PHONE
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (phone) Gravity.TOP or Gravity.CENTER_HORIZONTAL else Gravity.CENTER
            setPadding(if (phone) 24 else 54, if (phone) 24 else 36, if (phone) 24 else 54, if (phone) 24 else 36)
            setBackgroundColor(theme.background)
        }
        root.addView(title("BLOFY PLAYER", if (phone) 29f else 36f))
        root.addView(subtitle("فعّل جهازك ثم أضف قائمة التشغيل"))
        createIdentityViews(phone)
        root.addView(deviceView)
        root.addView(codeView)
        val qrSize = if (phone) 180 else 220
        root.addView(qrView, LinearLayout.LayoutParams(qrSize, qrSize))
        root.addView(status)
        addPlaylist = actionButton("إضافة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        val connect = actionButton("اتصال") { connect() }
        val buttonWidth = if (phone) LinearLayout.LayoutParams.MATCH_PARENT else 420
        root.addView(addPlaylist, LinearLayout.LayoutParams(buttonWidth, if (phone) 64 else 74))
        root.addView(connect, LinearLayout.LayoutParams(buttonWidth, if (phone) 64 else 74).apply { topMargin = 10 })
        return root
    }

    private fun buildCinemaTvLogin(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(48, 42, 48, 42)
            setBackgroundColor(theme.background)
        }
        createIdentityViews(false)

        val identityPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(36, 28, 36, 28)
            background = panelBackground()
        }
        identityPanel.addView(title("BLOFY", 40f))
        identityPanel.addView(subtitle("CINEMA • DEVICE ACTIVATION"))
        identityPanel.addView(qrView, LinearLayout.LayoutParams(250, 250))
        identityPanel.addView(deviceView)
        identityPanel.addView(codeView)
        root.addView(identityPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = 30 })

        val actionPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(42, 36, 42, 36)
            background = panelBackground()
        }
        actionPanel.addView(title("مرحبًا بك", 32f))
        actionPanel.addView(TextView(this).apply {
            text = "أضف قائمتك مرة واحدة، وبعدها اتصال يفتح البيانات المحلية مباشرة."
            textSize = 17f
            setTextColor(Color.rgb(215, 210, 225))
            setPadding(0, 10, 0, 28)
        })
        actionPanel.addView(status)
        addPlaylist = actionButton("إضافة / إدارة قائمة التشغيل") { startActivity(Intent(this, PlaylistActivity::class.java)) }
        val connect = actionButton("اتصال بـ BLOFY") { connect() }
        actionPanel.addView(addPlaylist, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 82))
        actionPanel.addView(connect, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 82).apply { topMargin = 14 })
        root.addView(actionPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        return root
    }

    private fun createIdentityViews(phone: Boolean) {
        deviceView = TextView(this).apply {
            text = "جاري إنشاء هوية الجهاز..."
            textSize = 17f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
        }
        codeView = TextView(this).apply {
            textSize = if (phone) 25f else 30f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, 6, 0, 8)
        }
        qrView = ImageView(this).apply {
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
    }

    private fun connect() {
        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val hasProvider = dao.providers().first().isNotEmpty()
            if (!hasProvider) {
                status.text = "أضف قائمة تشغيل أولاً"
                if (deviceKind == DeviceClass.Kind.TV) addPlaylist.requestFocus()
                return@launch
            }

            val endpoint = BuildConfig.ACTIVATION_BASE_URL.trim()
            if (endpoint.isBlank()) {
                openHome()
                return@launch
            }

            status.text = "جاري التحقق من تفعيل الجهاز..."
            val manager = ActivationManager(applicationContext, dao)
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                }
            }
            result.onSuccess { remote ->
                if (remote.canUse()) {
                    status.text = activationLabel(remote)
                    openHome()
                } else {
                    status.text = activationLabel(remote)
                }
            }.onFailure {
                val cached = withContext(Dispatchers.IO) { dao.activation() }
                if (cached != null && manager.cachedCanUse(cached)) {
                    status.text = "تعذر الوصول لخادم التفعيل • استخدام الصلاحية المحفوظة"
                    openHome()
                } else {
                    status.text = "تعذر التحقق من التفعيل"
                }
            }
        }
    }

    private fun activationLabel(remote: ActivationCheckResponse): String = when (remote.state()) {
        ActivationCheckResponse.State.TRIAL -> "الفترة التجريبية فعالة"
        ActivationCheckResponse.State.ACTIVE -> "الجهاز مفعل"
        ActivationCheckResponse.State.EXPIRED -> "انتهت صلاحية الجهاز"
        ActivationCheckResponse.State.BLOCKED -> "الجهاز موقوف"
        ActivationCheckResponse.State.UNKNOWN -> remote.message ?: "حالة التفعيل غير معروفة"
    }

    private fun openHome() {
        startActivity(Intent(this, HomeActivity::class.java))
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
            for (y in 0 until matrix.height) for (x in 0 until matrix.width) setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        val tv = deviceKind == DeviceClass.Kind.TV
        text = label
        isAllCaps = false
        textSize = 16f
        isFocusable = tv
        isFocusableInTouchMode = tv
        setTextColor(Color.WHITE)
        background = buttonBackground(false)
        setOnFocusChangeListener { view, focused ->
            if (!tv) return@setOnFocusChangeListener
            view.background = buttonBackground(focused)
            view.animate().scaleX(if (focused) theme.focusScale else 1f).scaleY(if (focused) theme.focusScale else 1f).setDuration(theme.motionMs).start()
        }
        setOnClickListener { action() }
    }

    private fun title(value: String, size: Float) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
    }

    private fun subtitle(value: String) = TextView(this).apply {
        text = value
        textSize = 16f
        setTextColor(theme.accent)
        gravity = Gravity.CENTER
        setPadding(0, 8, 0, 16)
    }

    private fun panelBackground() = GradientDrawable().apply {
        cornerRadius = 28f
        setColor(theme.surface)
        setStroke(1, theme.accent)
    }

    private fun buttonBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = if (theme.id == "cinema") 16f else 20f
        setColor(if (focused) theme.accent else theme.surface)
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else theme.accent)
    }
}
