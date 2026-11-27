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
import androidx.core.os.ConfigurationCompat
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
 * The original code form remains the default; direct providers use separate forms.
 */
class CodeOnlyLoginActivity : AppCompatActivity() {
    private lateinit var codeInput: EditText
    private lateinit var submitButton: Button
    private lateinit var statusText: TextView
    private var busy = false
    private enum class Mode { CODE, XTREAM, M3U }
    private var mode = Mode.CODE
    private lateinit var titleText: TextView
    private lateinit var hostInput: EditText
    private lateinit var userInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var linkInput: EditText
    private val modeButtons = linkedMapOf<Mode, Button>()
    private fun copy(ar: String, en: String) = if (ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") ar else en

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        buildPremiumScreen()
        if (intent.getBooleanExtra(EXTRA_CHOOSE_MODE, false)) {
            focusFirst()
        } else if (StreamDirectLogin.selected(this) != null) {
            restoreDirectSession()
        } else if (StreamCodeSession.isClaimed(this)) restoreSession() else focusFirst()
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

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        Mode.values().forEach { choice ->
            val tab = Button(this).apply {
                id = View.generateViewId()
                text = when (choice) {
                    Mode.CODE -> copy("الكود", "Code")
                    Mode.XTREAM -> copy("اكستريم", "Xtream")
                    Mode.M3U -> "M3U"
                }
                isAllCaps = false
                textSize = if (isTv) 16f else 14f
                typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
                stateListAnimator = null
                backgroundTintList = null
                isFocusable = true
                setOnFocusChangeListener { _, focused -> paintTab(this, choice, focused) }
                setOnClickListener { if (!busy) showMode(choice) }
            }
            modeButtons[choice] = tab
            tabs.addView(tab, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                marginStart = dp(3); marginEnd = dp(3)
            })
        }
        panel.addView(tabs, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(15) })
        titleText = TextView(this).apply {
            text = getString(R.string.stream_ui_code_title)
            textSize = if (isTv) 20f else 18f
            setTextColor(BlofyTvDesign.TextPrimary)
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(12))
        }
        panel.addView(titleText)
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

        fun directField(label: String, type: Int) = EditText(this).apply {
            id = View.generateViewId()
            hint = label
            contentDescription = label
            inputType = type
            imeOptions = EditorInfo.IME_ACTION_NEXT
            isSingleLine = true
            textSize = if (isTv) 19f else 16f
            textDirection = View.TEXT_DIRECTION_LTR
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(0xFF8CB7BD.toInt())
            setPadding(dp(15), 0, dp(15), 0)
            background = inputBackground(false)
            setOnFocusChangeListener { view, focused -> view.background = inputBackground(focused) }
            isFocusable = true
            isFocusableInTouchMode = true
            // Credentials and full playlist URLs must not enter saved view state.
            isSaveEnabled = false
            visibility = View.GONE
        }.also {
            panel.addView(it, LinearLayout.LayoutParams(-1, dp(if (isTv) 58 else 55)).apply { topMargin = dp(8) })
        }
        hostInput = directField(copy("رابط السيرفر (Host)", "Server URL (Host)"),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        userInput = directField(copy("اسم المستخدم", "Username"),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        passwordInput = directField(copy("كلمة المرور", "Password"),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        linkInput = directField(copy("رابط M3U (Xtream)", "M3U URL (Xtream)"),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        listOf(passwordInput, linkInput).forEach { field ->
            field.imeOptions = EditorInfo.IME_ACTION_DONE
            field.setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) { submitButton.performClick(); true } else false
            }
        }
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
            setOnClickListener { if (mode == Mode.CODE) activate() else connectDirect() }
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
                (if (ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") "العربية" else "English")
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
        showMode(Mode.CODE, focus = false)
    }

    private fun paintTab(button: Button, choice: Mode, focused: Boolean) {
        val selected = mode == choice
        button.setTextColor(if (selected) 0xFF052933.toInt() else BlofyTvDesign.TextPrimary)
        button.background = if (selected) BlofyTvDesign.primaryButton(dp(14).toFloat(), focused)
            else BlofyTvDesign.secondaryButton(dp(14).toFloat(), focused)
        button.isSelected = selected
        button.animate().cancel()
        button.animate().scaleX(if (focused) 1.023f else 1f)
            .scaleY(if (focused) 1.023f else 1f).setDuration(95L).start()
    }

    private fun showMode(choice: Mode, focus: Boolean = true) {
        mode = choice
        titleText.text = when (choice) {
            Mode.CODE -> getString(R.string.stream_ui_code_title)
            Mode.XTREAM -> copy("بيانات اكستريم", "Xtream login")
            Mode.M3U -> copy("رابط قائمة التشغيل", "Playlist URL")
        }
        val fields = when (choice) {
            Mode.CODE -> listOf(codeInput)
            Mode.XTREAM -> listOf(hostInput, userInput, passwordInput)
            Mode.M3U -> listOf(linkInput)
        }
        listOf(codeInput, hostInput, userInput, passwordInput, linkInput).forEach {
            it.visibility = if (it in fields) View.VISIBLE else View.GONE
        }
        modeButtons.forEach { (key, button) ->
            paintTab(button, key, button.hasFocus())
            button.nextFocusDownId = fields.first().id
        }
        fields.first().nextFocusUpId = modeButtons.getValue(choice).id
        fields.zipWithNext().forEach { (a, b) -> a.nextFocusDownId = b.id; b.nextFocusUpId = a.id }
        fields.last().nextFocusDownId = submitButton.id
        submitButton.nextFocusUpId = fields.last().id
        statusText.text = if (choice == Mode.CODE) getString(R.string.stream_ui_subscription_notice)
            else copy("استخدم بيانات اشتراكك لدى مزود المحتوى.", "Use your content provider subscription details.")
        submitButton.text = if (choice == Mode.CODE) getString(R.string.stream_ui_start) else copy("دخول", "Connect")
        if (focus) fields.first().requestFocus()
    }

    private fun connectDirect() {
        if (busy) return
        val credentials = when (mode) {
            Mode.XTREAM -> StreamDirectLogin.xtream(hostInput.text.toString(),
                userInput.text.toString(), passwordInput.text.toString())
            Mode.M3U -> StreamDirectLogin.m3u(linkInput.text.toString())
            Mode.CODE -> null
        }
        if (credentials == null) {
            statusText.text = if (mode == Mode.M3U)
                copy("أدخل رابط M3U صادرًا من اكستريم يحتوي على بيانات الاشتراك.", "Enter an Xtream-exported M3U URL with subscription credentials.")
                else copy("تحقق من رابط السيرفر واسم المستخدم وكلمة المرور.", "Check the server URL, username and password.")
            return
        }
        if (credentials.host.startsWith("http://", true)) {
            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle(R.string.playlist_form_http_dialog_title)
                .setMessage(R.string.playlist_form_http_dialog_message)
                .setNegativeButton(R.string.playlist_form_back, null)
                .setPositiveButton(R.string.playlist_form_continue) { _, _ -> openDirect(credentials) }
                .show()
        } else openDirect(credentials)
    }

    private fun openDirect(credentials: StreamDirectLogin.Credentials) {
        if (busy) return
        setBusy(true)
        statusText.text = copy("جاري إعداد القائمة…", "Preparing playlist…")
        lifecycleScope.launch {
            try {
                val requested = credentials.provider()
                val provider = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    val previous = dao.provider(requested.id)
                    // Keep the working library and credentials if an edited login fails.
                    val next = if (previous != null && (previous.password != requested.password ||
                        previous.liveFormat != requested.liveFormat)) {
                        requested.copy(id = requested.id + "-" + java.util.UUID.randomUUID())
                    } else requested
                    if (previous == null || next.id != requested.id) {
                        CatalogSyncState.markPending(applicationContext, next.id)
                    }
                    dao.upsertProvider(next.copy(enabled = previous?.id == next.id && previous?.enabled == true))
                    StreamDirectLogin.select(applicationContext, next.id)
                    next
                }
                passwordInput.text?.clear()
                linkInput.text?.clear()
                startActivity(Intent(this@CodeOnlyLoginActivity, CatalogLoadingActivity::class.java)
                    .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id))
                finish()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                statusText.text = copy("تعذر إعداد القائمة. حاول مجددًا.", "Could not prepare the playlist. Try again.")
                setBusy(false)
            }
        }
    }

    private fun restoreDirectSession() {
        val id = StreamDirectLogin.selected(this) ?: return focusFirst()
        setBusy(true)
        lifecycleScope.launch {
            try {
                val ready = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    if (!CatalogSyncState.isReady(applicationContext, id) || !dao.hasCatalog(id)) false
                    else { dao.activateExistingProvider(id); true }
                }
                if (ready) {
                    startActivity(Intent(this@CodeOnlyLoginActivity, HomeActivity::class.java))
                    finish()
                } else {
                    StreamDirectLogin.clear(applicationContext)
                    showMode(Mode.XTREAM)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                statusText.text = copy("تعذر استعادة القائمة.", "Could not restore playlist.")
            } finally { setBusy(false) }
        }
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
                if (ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "ar") 0 else 1) { dialog, which ->
                val tag = if (which == 0) "ar" else "en"
                dialog.dismiss()
                // A second locale recreation during pairing can leave a black
                // Activity surface on some Android TV firmware versions.
                tv.blofy.player.ui.settings.StreamLanguageSwitcher.change(this, tag)
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
        modeButtons.values.forEach { it.isEnabled = !working }
        listOf(hostInput, userInput, passwordInput, linkInput).forEach { it.isEnabled = !working }
    }

    private fun activate() {
        if (busy) return
        val code = StreamCodeClient.normalizeCode(codeInput.text.toString())
        if (code.isEmpty()) {
            if (StreamCodeSession.isClaimed(this)) { restoreSession(); return }
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
                    StreamDirectLogin.clear(applicationContext)
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
                            StreamDirectLogin.clear(applicationContext)
                        }
                        val ready=withContext(Dispatchers.IO) {
                            CatalogSyncState.isReady(applicationContext,StreamCodeSession.providerId) &&
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

    companion object { const val EXTRA_CHOOSE_MODE = "choose_stream_login_mode" }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
