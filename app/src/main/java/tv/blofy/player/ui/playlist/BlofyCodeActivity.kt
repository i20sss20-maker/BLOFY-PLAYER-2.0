package tv.blofy.player.ui.playlist

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
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
import tv.blofy.player.R
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.identity.BlofyCodeClient
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.ui.common.BlofyTvDesign

/** Dedicated BLOFY code login; old STROING 8K and Xtream paths are unchanged. */
class BlofyCodeActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.CODE_ONLY_LOGIN) {
            startActivity(Intent(this, tv.blofy.player.ui.login.CodeOnlyLoginActivity::class.java))
            finish()
            return
        }
        val isTv = DeviceClass.isTv(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(if (isTv) 56 else 22), dp(30), dp(if (isTv) 56 else 22), dp(28))
            background = AppCompatResources.getDrawable(this@BlofyCodeActivity, R.drawable.blofy_home_background)
        }
        content.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = getString(R.string.app_name)
        }, LinearLayout.LayoutParams(dp(152), dp(76)))

        fun label(resId: Int, size: Float, heading: Boolean = false) = TextView(this).apply {
            setText(resId)
            textSize = size
            typeface = if (heading) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
            setTextColor(if (heading) BlofyTvDesign.TextPrimary else BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
        }

        content.addView(label(R.string.blofy_code_title, if (isTv) 29f else 25f, true))
        content.addView(label(R.string.blofy_code_subtitle, if (isTv) 15f else 14f),
            LinearLayout.LayoutParams(if (isTv) dp(700) else -1, -2).apply { bottomMargin = dp(20) })

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(26), dp(24), dp(24))
            background = GradientDrawable().apply {
                setColor(0xEE151020.toInt())
                cornerRadius = dp(24).toFloat()
                setStroke(dp(1), 0xFF67458E.toInt())
            }
            clipChildren = false
            clipToPadding = false
        }
        content.addView(panel, LinearLayout.LayoutParams(if (isTv) dp(640) else -1, -2))
        panel.addView(label(R.string.blofy_code_label, 17f, true))

        val code = EditText(this).apply {
            id = View.generateViewId()
            hint = getString(R.string.blofy_code_hint)
            isSingleLine = true
            textSize = if (isTv) 22f else 18f
            gravity = Gravity.CENTER
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            textDirection = View.TEXT_DIRECTION_LTR
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            imeOptions = EditorInfo.IME_ACTION_DONE
            setTextColor(Color.WHITE)
            setHintTextColor(0xFF9384A4.toInt())
            setPadding(dp(18), 0, dp(18), 0)
            background = inputBackground(false)
            isFocusable = true
            isFocusableInTouchMode = true
            setOnFocusChangeListener { view, hasFocus -> view.background = inputBackground(hasFocus) }
        }
        panel.addView(code, LinearLayout.LayoutParams(-1, dp(64)).apply { bottomMargin = dp(12) })

        val status = label(R.string.blofy_code_pending, 13f).apply {
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }

        var submitting = false
        lateinit var enter: Button
        fun submit() {
            if (submitting) return
            val codeValue = code.text.toString().trim()
            if (codeValue.isBlank()) {
                status.setText(R.string.blofy_code_required)
                code.requestFocus()
                return
            }
            if (!codeValue.matches(Regex("[A-Za-z0-9-]{8,32}"))) {
                status.setText(R.string.blofy_code_invalid)
                code.requestFocus()
                return
            }
            if (BuildConfig.ACTIVATION_BASE_URL.isBlank()) {
                status.setText(R.string.blofy_code_unconfigured)
                return
            }
            submitting = true
            enter.isEnabled = false
            code.isEnabled = false
            status.setText(R.string.blofy_code_verifying)
            lifecycleScope.launch {
                try {
                    val prepared = withContext(Dispatchers.IO) {
                        val account = BlofyCodeClient.redeem(applicationContext, codeValue)
                        val dao = BlofyDatabase.get(applicationContext).dao()
                        val existing = dao.provider(account.id)
                        // Use the existing catalog integration; NEVER alter the player engines.
                        val next = ProviderEntity(
                            id = account.id,
                            name = account.name,
                            baseUrl = account.baseUrl,
                            username = account.username,
                            password = account.password,
                            providerType = "xtream",
                            liveFormat = existing?.liveFormat ?: "ts",
                            preferredTransport = existing?.preferredTransport ?: "cronet",
                            preferredEngine = existing?.preferredEngine ?: "media3",
                            allowCrossProtocolRedirects = existing?.allowCrossProtocolRedirects ?: true,
                            enabled = existing?.enabled ?: false
                        )
                        PortalPlaylistClient.prepareSubscriberProvider(
                            applicationContext, BuildConfig.ACTIVATION_BASE_URL.trim(), dao, next, account.id
                        )
                    }
                    setResult(RESULT_OK)
                    startActivity(Intent(this@BlofyCodeActivity, CatalogLoadingActivity::class.java).apply {
                        putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, prepared.providerId)
                        putExtra(CatalogLoadingActivity.EXTRA_FORCE_REFRESH,
                            prepared.sourceChanged && prepared.hadReadyCatalog)
                        prepared.approvedSourceFingerprint?.let {
                            putExtra(CatalogLoadingActivity.EXTRA_APPROVED_SOURCE_FINGERPRINT, it)
                        }
                    })
                    finish()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    val key = error.message.orEmpty()
                    status.setText(when (key) {
                        "invalid_code" -> R.string.blofy_code_invalid
                        "code_unavailable" -> R.string.blofy_code_unavailable
                        "device_not_active" -> R.string.blofy_code_device_inactive
                        "rate_limited" -> R.string.blofy_code_rate_limited
                        else -> R.string.blofy_code_network_error
                    })
                    code.requestFocus()
                } finally {
                    submitting = false
                    if (!isFinishing && !isDestroyed) {
                        enter.isEnabled = true
                        code.isEnabled = true
                    }
                }
            }
        }

        enter = Button(this).apply {
            id = View.generateViewId()
            text = getString(R.string.blofy_code_submit)
            isAllCaps = false
            textSize = 17f
            setTextColor(Color.WHITE)
            typeface = BlofyTvDesign.HeadingTypeface
            gravity = Gravity.CENTER
            if (isTv) BlofyTvDesign.installTvFocus(this, dp(17).toFloat(), 1.025f, true)
            else background = BlofyTvDesign.primaryButton(dp(17).toFloat(), false)
            setOnClickListener { submit() }
        }
        code.nextFocusDownId = enter.id
        enter.nextFocusUpId = code.id
        panel.addView(enter, LinearLayout.LayoutParams(-1, dp(62)))
        panel.addView(status, LinearLayout.LayoutParams(-1, -2))

        code.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) { submit(); true } else false
        }

        setContentView(ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(content)
        })
        if (isTv) enter.requestFocus() else code.requestFocus()
    }

    private fun inputBackground(focused: Boolean) = GradientDrawable().apply {
        setColor(0xFF110F19.toInt())
        cornerRadius = dp(16).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) BlofyTvDesign.FocusStroke else 0xFF524165.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
