package tv.blofy.player.ui.login

import android.content.Intent
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.CodeHostClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign

/**
 * Standalone code-only edition. The login screen has one field and one action.
 * No QR, device identifier, host input, username or playlist editing is shown.
 * Device identification remains an internal server-side authentication detail.
 */
class CodeOnlyLoginActivity : AppCompatActivity() {
    private lateinit var code: EditText
    private lateinit var submit: Button
    private lateinit var status: TextView
    private val isTv by lazy { DeviceClass.detect(this) == DeviceClass.Kind.TV }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildScreen())
        code.requestFocus()
    }

    private fun buildScreen(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (isTv) 36 else 18), dp(28), dp(if (isTv) 36 else 18), dp(28))
            background = AppCompatResources.getDrawable(this@CodeOnlyLoginActivity, R.drawable.blofy_home_background)
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (isTv) 42 else 22), dp(if (isTv) 38 else 28), dp(if (isTv) 42 else 22), dp(if (isTv) 38 else 28))
            background = BlofyTvDesign.elevatedSurface(dp(26).toFloat(), emphasis = true)
        }

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            contentDescription = "BLOFY PLAYER"
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
        }, LinearLayout.LayoutParams(dp(if (isTv) 180 else 146), dp(if (isTv) 92 else 74)))

        panel.addView(TextView(this).apply {
            text = "أدخل كود الاشتراك"
            textSize = if (isTv) 27f else 23f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(22))
        })

        code = EditText(this).apply {
            hint = "الكود"
            contentDescription = "كود الدخول"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_DONE
            filters = arrayOf(InputFilter.LengthFilter(64))
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextMuted)
            textSize = if (isTv) 26f else 22f
            gravity = Gravity.CENTER
            background = BlofyTvDesign.inputField(dp(14).toFloat(), false)
            setPadding(dp(14), 0, dp(14), 0)
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    login()
                    true
                } else false
            }
        }
        panel.addView(code, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(66)))

        submit = Button(this).apply {
            text = "دخول"
            isAllCaps = false
            textSize = if (isTv) 19f else 17f
            setTextColor(BlofyTvDesign.TextPrimary)
            background = BlofyTvDesign.primaryButton(dp(14).toFloat(), false)
            setOnFocusChangeListener { view, focused ->
                view.background = BlofyTvDesign.primaryButton(dp(14).toFloat(), focused)
            }
            setOnClickListener { login() }
        }
        panel.addView(submit, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply {
            topMargin = dp(14)
        })

        status = TextView(this).apply {
            visibility = View.GONE
            textSize = 14f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(14), dp(8), 0)
        }
        panel.addView(status, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        root.addView(panel, LinearLayout.LayoutParams(if (isTv) dp(570) else LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT))
        return ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(root)
        }
    }

    private fun showStatus(message: String) {
        status.text = message
        status.visibility = View.VISIBLE
    }

    private fun login() {
        if (!submit.isEnabled) return
        val value = code.text.toString().trim()
        if (!value.matches(Regex("[A-Za-z0-9_-]{4,64}"))) {
            showStatus("أدخل كوداً صحيحاً")
            return
        }
        if (BuildConfig.CODE_AUTH_BASE_URL.isBlank()) {
            showStatus("الهوست غير مهيأ بعد")
            return
        }
        lifecycleScope.launch {
            submit.isEnabled = false
            showStatus("جاري التحقق من الكود...")
            try {
                val provider = CodeHostClient.login(applicationContext, BuildConfig.CODE_AUTH_BASE_URL, value)
                withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao().saveAndActivateProvider(provider)
                }
                // The access code is never saved locally.
                CatalogSyncState.markPending(applicationContext, provider.id)
                showStatus("تم الدخول • جاري تجهيز المكتبة")
                startActivity(Intent(this@CodeOnlyLoginActivity, CatalogLoadingActivity::class.java)
                    .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
                finish()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                showStatus(error.message ?: "تعذر تسجيل الدخول")
            } finally {
                submit.isEnabled = true
            }
        }
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
