package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.CodeHostClient
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Independent app edition: QR/device identity + a single access-code input.
 * No user-facing upstream host, Xtream credentials or playlist management.
 * Playback, library and catalog screens are reused from BLOFY PLAYER.
 */
class CodeOnlyLoginActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var code: EditText
    private lateinit var submit: Button
    private lateinit var qr: ImageView
    private lateinit var deviceLabel: TextView
    private val isTv by lazy { DeviceClass.detect(this) == DeviceClass.Kind.TV }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildScreen())
        lifecycleScope.launch { renderQr() }
        code.requestFocus()
    }

    private fun buildScreen(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER
            setPadding(dp(if (isTv) 42 else 18), dp(22), dp(if (isTv) 42 else 18), dp(22))
            background = AppCompatResources.getDrawable(this@CodeOnlyLoginActivity, R.drawable.blofy_home_background)
        }

        root.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }, LinearLayout.LayoutParams(dp(if (isTv) 168 else 138), dp(if (isTv) 84 else 72)))

        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = if (isTv) 30f else 25f
            letterSpacing = .08f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "دخول سريع بالكود"
            textSize = if (isTv) 18f else 15f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(22))
        })

        val row = LinearLayout(this).apply {
            orientation = if (isTv) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            gravity = Gravity.CENTER
            clipChildren = false
        }
        val qrPanel = card().apply { gravity = Gravity.CENTER }
        qrPanel.addView(TextView(this).apply {
            text = "رمز جهازك"
            textSize = 20f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        })
        qr = ImageView(this).apply {
            contentDescription = "باركود QR لتعريف الجهاز"
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = dp(14).toFloat()
            }
            setPadding(dp(12), dp(12), dp(12), dp(12))
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        qrPanel.addView(qr, LinearLayout.LayoutParams(dp(if (isTv) 224 else 188), dp(if (isTv) 224 else 188)).apply {
            topMargin = dp(12)
        })
        deviceLabel = TextView(this).apply {
            textSize = 13f
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, 0)
        }
        qrPanel.addView(deviceLabel)
        qrPanel.addView(TextView(this).apply {
            text = "امسح الرمز لعرض هوية الجهاز"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextMuted)
        })

        val codePanel = card().apply { gravity = Gravity.CENTER_VERTICAL }
        codePanel.addView(TextView(this).apply {
            text = "أدخل كود الاشتراك"
            textSize = if (isTv) 24f else 21f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        })
        codePanel.addView(TextView(this).apply {
            text = "بدون اسم مستخدم أو كلمة مرور أو إدخال هوست"
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(20))
        })

        code = EditText(this).apply {
            hint = "الكود"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            filters = arrayOf(InputFilter.LengthFilter(64), InputFilter.AllCaps())
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextMuted)
            textSize = if (isTv) 25f else 22f
            gravity = Gravity.CENTER
            background = BlofyTvDesign.inputField(dp(14).toFloat(), false)
            setPadding(dp(14), 0, dp(14), 0)
        }
        codePanel.addView(code, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)))

        submit = Button(this).apply {
            text = "دخول"
            isAllCaps = false
            textSize = 19f
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.primaryButton(dp(14).toFloat(), false)
            setOnFocusChangeListener { view, focused ->
                view.background = BlofyTvDesign.primaryButton(dp(14).toFloat(), focused)
            }
            setOnClickListener { login() }
        }
        codePanel.addView(submit, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(14) })

        status = TextView(this).apply {
            text = "أدخل الكود للاتصال"
            textSize = 14f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(12), dp(8), dp(12))
        }
        codePanel.addView(status)

        if (isTv) {
            row.addView(qrPanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(12) })
            row.addView(codePanel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(12) })
            root.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            return root
        }
        row.addView(qrPanel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
        row.addView(codePanel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        return ScrollView(this).apply {
            isFillViewport = true
            addView(root)
        }
    }

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(if (isTv) 28 else 20), dp(22), dp(if (isTv) 28 else 20), dp(22))
        background = BlofyTvDesign.elevatedSurface(dp(24).toFloat(), emphasis = true)
    }

    private suspend fun renderQr() {
        val deviceId = DeviceIdentity.deviceId(applicationContext)
        deviceLabel.text = deviceId
        // When a pairing portal is configured, display its link; otherwise the QR contains
        // ONLY the non-secret device ID. Scanning the QR alone never signs a device in.
        val pairUrl = BuildConfig.CODE_PAIR_URL.trim()
        val destination = if (pairUrl.startsWith("https://", ignoreCase = true)) {
            Uri.parse(pairUrl).buildUpon().appendQueryParameter("deviceId", deviceId).build().toString()
        } else deviceId
        val image = withContext(Dispatchers.Default) { createQr(destination) }
        if (!isFinishing && !isDestroyed) qr.setImageBitmap(image)
    }

    private fun login() {
        if (!::submit.isInitialized || !submit.isEnabled) return
        val value = code.text.toString().trim()
        if (!value.matches(Regex("[A-Za-z0-9_-]{4,64}"))) {
            status.text = "أدخل كوداً صحيحاً"
            return
        }
        if (BuildConfig.CODE_AUTH_BASE_URL.isBlank()) {
            status.text = "الهوست غير مهيأ بعد"
            return
        }
        lifecycleScope.launch {
            submit.isEnabled = false
            status.text = "جاري التحقق من الكود..."
            try {
                val provider = CodeHostClient.login(applicationContext, BuildConfig.CODE_AUTH_BASE_URL, value)
                withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao().saveAndActivateProvider(provider)
                }
                // Never store the access code in preferences or the provider name.
                CatalogSyncState.markPending(applicationContext, provider.id)
                status.text = "تم الدخول • جاري تجهيز المكتبة"
                startActivity(Intent(this@CodeOnlyLoginActivity, CatalogLoadingActivity::class.java)
                    .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
                finish()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status.text = error.message ?: "تعذر تسجيل الدخول"
            } finally {
                submit.isEnabled = true
            }
        }
    }

    private fun createQr(value: String): Bitmap {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 320, 320,
            mapOf(EncodeHintType.MARGIN to 1))
        return Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).apply {
            for (y in 0 until matrix.height) {
                for (x in 0 until matrix.width) {
                    setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
                }
            }
        }
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
