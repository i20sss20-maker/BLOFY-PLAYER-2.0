package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import tv.blofy.player.ui.settings.RuntimeSettings
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.diagnostics.StreamConnectionDiagnostics
import tv.blofy.player.core.identity.StreamCodeClient
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity

/**
 * Dedicated BLOFY STREAM ocean/cyan identity with readable mobile layout,
 * bundled Arabic font and TV D-pad access; no PLAYER sign-in options.
 * Only a numeric code is shown. Host, M3U, usernames and passwords are hidden.
 */
class CodeOnlyLoginActivity : AppCompatActivity() {
    private lateinit var codeInput: EditText
    private lateinit var submitButton: Button
    private lateinit var statusText: TextView
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        buildPremiumScreen()
        if (StreamCodeSession.isClaimed(this)) restoreSession() else focusFirst()
    }

    private fun buildPremiumScreen() {
        val isTv = DeviceClass.isTv(this)
        val narrow = resources.configuration.screenWidthDp < 510
        val widthDp = resources.configuration.screenWidthDp
        val horizontalPad = if (narrow) 18 else if (isTv) 45 else 25
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(horizontalPad), dp(32), dp(horizontalPad), dp(32))
        }
        val baseDrawable = AppCompatResources.getDrawable(this, R.drawable.blofy_home_background)
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            this.background = baseDrawable
            addView(container)
        }

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF143E4C.toInt(), 0xFF0B2A36.toInt(), 0xFF071C26.toInt())
            ).apply {
                cornerRadius = dp(26).toFloat()
                setStroke(dp(1), 0xFF327F89.toInt())
            }
            setPadding(dp(if (narrow) 22 else 38), dp(26),
                dp(if (narrow) 22 else 38), dp(30))
        }
        val maxWidth = (widthDp - 2 * horizontalPad).coerceAtLeast(260)
        container.addView(panel, LinearLayout.LayoutParams(
            if (narrow) LinearLayout.LayoutParams.MATCH_PARENT else dp(minOf(620, maxWidth)),
            LinearLayout.LayoutParams.WRAP_CONTENT))

        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.stream_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = getString(R.string.stream_ui_brand_description)
        }, LinearLayout.LayoutParams(dp(172), dp(108)).apply { bottomMargin = dp(6) })

        panel.addView(TextView(this).apply {
            text = "BLOFY STREAM"
            textSize = if (isTv) 34f else 28f
            letterSpacing = 0.045f
            setTextColor(Color.WHITE)
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            gravity = Gravity.CENTER
            includeFontPadding = false
        })
        panel.addView(TextView(this).apply {
            text = getString(R.string.stream_ui_tagline)
            textSize = if (isTv) 17f else 15f
            setTextColor(BlofyTvDesign.PurpleSoft)
            typeface = BlofyTvDesign.preferredTypeface(this)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(10))
        })
        panel.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0x0046E4D0, 0xFF46E4D0.toInt(), 0x0046E4D0)
            )
        }, LinearLayout.LayoutParams(dp(215), dp(1)).apply { bottomMargin = dp(23) })

        panel.addView(TextView(this).apply {
            text = getString(R.string.stream_ui_code_title)
            textSize = if (isTv) 20f else 18f
            setTextColor(BlofyTvDesign.TextPrimary)
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(12))
        })
        codeInput = EditText(this).apply {
            id = View.generateViewId()
            hint = "•••• ••••"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(12))
            imeOptions = EditorInfo.IME_ACTION_DONE
            isSingleLine = true
            textSize = if (isTv) 27f else 24f
            letterSpacing = .21f
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            textDirection = View.TEXT_DIRECTION_LTR
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(0xFF8CB7BD.toInt())
            background = inputBackground(false)
            setOnFocusChangeListener { v, focused -> v.background = inputBackground(focused) }
            isFocusable = true
            isFocusableInTouchMode = true
            contentDescription = getString(R.string.stream_ui_code_description)
        }
        panel.addView(codeInput, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(if (isTv) 75 else 68)))

        submitButton = Button(this).apply {
            id = View.generateViewId()
            text = getString(R.string.stream_ui_start)
            isAllCaps = false
            textSize = if (isTv) 20f else 18f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(0xFF052933.toInt())
            background = BlofyTvDesign.primaryButton(dp(16).toFloat(), false)
            stateListAnimator = null
            isFocusable = true
            setOnFocusChangeListener { v, focused ->
                v.background = BlofyTvDesign.primaryButton(dp(16).toFloat(), focused)
                v.animate().cancel()
                v.animate().scaleX(if (focused) 1.023f else 1f)
                    .scaleY(if (focused) 1.023f else 1f)
                    .setDuration(95L).start()
            }
            setOnClickListener { activate() }
        }
        panel.addView(submitButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(17) })

        statusText = TextView(this).apply {
            text = getString(R.string.stream_ui_subscription_notice)
            textSize = 13.5f
            setTextColor(BlofyTvDesign.TextMuted)
            typeface = BlofyTvDesign.preferredTypeface(this)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(19), dp(8), dp(7))
        }
        panel.addView(statusText)
        panel.addView(TextView(this).apply {
            text = getString(R.string.stream_ui_secure_notice)
            textSize = 11.5f
            setTextColor(BlofyTvDesign.PurpleSoft)
            typeface = BlofyTvDesign.preferredTypeface(this)
            gravity = Gravity.CENTER
        })

        // Language is reachable before entering a code, including on a TV remote.
        val languageButton = Button(this).apply {
            id = View.generateViewId()
            text = getString(R.string.stream_ui_language) + "  •  " +
                if (resources.configuration.locales[0]?.language == "ar") "العربية" else "English"
            isAllCaps = false
            textSize = if (isTv) 16f else 14f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextPrimary)
            backgroundTintList = null
            background = BlofyTvDesign.secondaryButton(dp(14).toFloat())
            stateListAnimator = null
            isFocusable = true
            setOnFocusChangeListener { view, focused ->
                view.background = BlofyTvDesign.secondaryButton(dp(14).toFloat(), focused)
            }
            setOnClickListener { chooseStreamLanguage() }
        }
        panel.addView(languageButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(if (isTv) 50 else 46)).apply {
                topMargin = dp(18)
            })
        submitButton.nextFocusDownId = languageButton.id
        languageButton.nextFocusUpId = submitButton.id

        codeInput.nextFocusDownId = submitButton.id
        submitButton.nextFocusUpId = codeInput.id
        codeInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submitButton.performClick(); true
            } else false
        }
        setContentView(scroll)
    }

    // Some TV boxes use a numpad Enter or gamepad A instead of DPAD_CENTER.
    // Handle only submit focus; retain normal EditText cursor/IME behavior.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && !busy && ::submitButton.isInitialized &&
            submitButton.hasFocus() && event.keyCode in listOf(
                KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A
            )
        ) {
            submitButton.performClick()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun chooseStreamLanguage() {
        val languages = arrayOf(getString(R.string.stream_ui_arabic),
            getString(R.string.stream_ui_english))
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(getString(R.string.stream_ui_language))
            .setSingleChoiceItems(languages,
                if (resources.configuration.locales[0]?.language == "ar") 0 else 1) { dialog, which ->
                val tag = if (which == 0) "ar" else "en"
                val saved = getSharedPreferences(RuntimeSettings.PREFS, MODE_PRIVATE).edit()
                    .putString("app_language_tag", tag)
                    .putString("app_language", if (which == 0) "العربية" else "English")
                    .putBoolean("stream_language_choice_made", true)
                    .commit()
                if (saved) {
                    dialog.dismiss()
                    AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                }
            }
            .setNegativeButton(getString(R.string.stream_ui_cancel), null)
            .show()
    }

    private fun inputBackground(focused: Boolean) = GradientDrawable().apply {
        setColor(0xFF0A2633.toInt())
        cornerRadius = dp(16).toFloat()
        setStroke(dp(if (focused) 2 else 1),
            if (focused) BlofyTvDesign.FocusStroke else 0xFF376671.toInt())
    }

    private fun focusFirst() {
        // A TV remote should land directly on the primary action; the user
        // can move up to enter the code without cycling through decoration.
        if (DeviceClass.isTv(this)) submitButton.requestFocus() else codeInput.requestFocus()
    }

    private fun setBusy(working: Boolean) {
        busy = working
        codeInput.isEnabled = !working
        submitButton.isEnabled = !working
    }

    private fun activate() {
        if (busy) return
        val code = StreamCodeClient.normalizeCode(codeInput.text.toString())
        if (code.isEmpty()) {
            statusText.text = getString(R.string.stream_ui_code_length)
            codeInput.requestFocus()
            return
        }
        setBusy(true)
        statusText.text = getString(R.string.stream_ui_activating)
        lifecycleScope.launch {
            try {
                // Generate the installation binding BEFORE redeeming, allowing
                // the exact same code to retry if its first response was lost.
                val binding = StreamCodeSession.installationKey(applicationContext)
                val result = StreamCodeClient.redeem(code, binding)
                withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    dao.upsertProvider(ProviderEntity(
                        id = StreamCodeSession.providerId,
                        name = "BLOFY STREAM",
                        baseUrl = StreamCodeSession.HOST,
                        username = "",
                        password = "",
                        providerType = "xtream",
                        liveFormat = "ts",
                        preferredTransport = "http",
                        preferredEngine = "media3",
                        allowCrossProtocolRedirects = false,
                        enabled = true
                    ))
                    dao.disableAllProviders()
                    dao.activateProvider(StreamCodeSession.providerId)
                    StreamCodeSession.save(applicationContext,result.accessToken,
                        result.activatedAt,result.expiresAt)
                    CatalogSyncState.markPending(applicationContext,StreamCodeSession.providerId)
                }
                codeInput.text?.clear()
                statusText.text = getString(R.string.stream_ui_activated)
                startActivity(Intent(this@CodeOnlyLoginActivity,
                    CatalogLoadingActivity::class.java)
                    .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, StreamCodeSession.providerId))
                finish()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                // Preserve explicit redemption errors but never print raw TLS/URL or Java messages.
                val classified = StreamConnectionDiagnostics.classify(error)
                val message = error.message.orEmpty()
                statusText.text = when {
                    classified != StreamConnectionDiagnostics.Cause.OTHER ->
                        StreamConnectionDiagnostics.guidance(this@CodeOnlyLoginActivity, classified)
                    message == "الكود مستخدم أو غير متاح. تواصل مع المسؤول" ->
                        getString(R.string.stream_ui_code_used)
                    message == "محاولات كثيرة، أعد المحاولة لاحقًا" ->
                        getString(R.string.stream_ui_too_many_attempts)
                    message == "كود غير صحيح" ->
                        getString(R.string.stream_ui_invalid_code)
                    message == "تعذر تفعيل الكود. تحقق من الاتصال" ->
                        getString(R.string.stream_ui_activation_connection)
                    else -> getString(R.string.stream_ui_activation_failed)
                }
                setBusy(false)
                codeInput.requestFocus()
            }
        }
    }

    private fun restoreSession() {
        if (busy) return
        setBusy(true)
        statusText.text = getString(R.string.stream_ui_restoring)
        lifecycleScope.launch {
            try {
                val saved = withContext(Dispatchers.IO) {
                    BlofyDatabase.get(applicationContext).dao()
                        .provider(StreamCodeSession.providerId)
                }
                val token=StreamCodeSession.token(applicationContext)
                if (saved == null || token == null) {
                    StreamCodeSession.clearClaim(applicationContext)
                    statusText.text = getString(R.string.stream_ui_restore_failed)
                } else when (StreamCodeClient.verifySession(token)) {
                    true -> {
                        val dao=BlofyDatabase.get(applicationContext).dao()
                        withContext(Dispatchers.IO) {
                            dao.disableAllProviders()
                            dao.activateProvider(StreamCodeSession.providerId)
                        }
                        val ready=withContext(Dispatchers.IO) {
                            CatalogSyncState.isEntryReady(applicationContext,StreamCodeSession.providerId) &&
                                dao.hasCatalog(StreamCodeSession.providerId)
                        }
                        startActivity(Intent(this@CodeOnlyLoginActivity,
                            if (ready) HomeActivity::class.java else CatalogLoadingActivity::class.java)
                            .apply {
                                if(!ready) putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID,
                                    StreamCodeSession.providerId)
                            })
                        finish()
                        return@launch
                    }
                    false -> {
                        StreamCodeSession.clearClaim(applicationContext)
                        statusText.text = getString(R.string.stream_ui_subscription_inactive)
                    }
                    null -> {
                        val check = StreamConnectionDiagnostics.probe()
                        statusText.text = if (check.reachable)
                            getString(R.string.stream_ui_check_retry)
                        else getString(R.string.stream_ui_saved_offline,
                            StreamConnectionDiagnostics.guidance(this@CodeOnlyLoginActivity,
                                check.cause ?: StreamConnectionDiagnostics.Cause.OTHER))
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                statusText.text = getString(R.string.stream_ui_verify_failed)
            } finally {
                setBusy(false)
                if (!isFinishing) focusFirst()
            }
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
