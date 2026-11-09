package tv.blofy.player.ui.login

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.text.InputFilter
import android.view.Gravity
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
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.identity.StreamCodeClient
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.home.HomeActivity

/**
 * Login screen for the separately packaged BLOFY code-only edition.
 * No device QR, Xtream host, username, password, or playlist input is exposed.
 */
class CodeOnlyLoginActivity : AppCompatActivity() {
    private lateinit var codeField: EditText
    private lateinit var activateButton: Button
    private lateinit var statusView: TextView
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        buildScreen()
        if (StreamCodeSession.isClaimed(this)) restoreExistingSession()
        else codeField.requestFocus()
    }

    private fun buildScreen() {
        val small = resources.configuration.screenWidthDp < 440
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(
                this@CodeOnlyLoginActivity, R.drawable.blofy_home_background)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(if (small) 20 else 45), dp(22),
                dp(if (small) 20 else 45), dp(22))
        }
        scroll.addView(root)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(if (small) 20 else 38), dp(30),
                dp(if (small) 20 else 38), dp(32))
            background = BlofyTvDesign.elevatedSurface(26f, emphasis = true)
        }
        // On narrow tablets and portrait TV boxes, never position a
        // 630dp panel outside the visible viewport.
        val maxPanelWidthDp =
            (resources.configuration.screenWidthDp - if (small) 40 else 90)
                .coerceAtLeast(240)
        root.addView(panel, LinearLayout.LayoutParams(
            if (small) LinearLayout.LayoutParams.MATCH_PARENT
            else dp(minOf(630, maxPanelWidthDp)),
            LinearLayout.LayoutParams.WRAP_CONTENT))
        panel.addView(ImageView(this).apply {
            setImageResource(R.drawable.blofy_logo)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }, LinearLayout.LayoutParams(dp(180), dp(104)))
        panel.addView(TextView(this).apply {
            text = "BLOFY STREAM"
            textSize = if (small) 28f else 33f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
        })
        panel.addView(TextView(this).apply {
            text = "أدخل كود الاشتراك للتفعيل وابدأ المشاهدة"
            textSize = if (small) 14f else 16f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(0, dp(8), 0, dp(24))
        })
        codeField = EditText(this).apply {
            id = View.generateViewId()
            hint = "كود التفعيل"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(12))
            imeOptions = EditorInfo.IME_ACTION_DONE
            isSingleLine = true
            textSize = if (small) 23f else 27f
            letterSpacing = .14f
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextDim)
            background = BlofyTvDesign.inputField(18f, false)
            setOnFocusChangeListener { view, focused ->
                view.background = BlofyTvDesign.inputField(18f, focused)
            }
        }
        panel.addView(codeField, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(70)))
        activateButton = Button(this).apply {
            id = View.generateViewId()
            text = "تفعيل الاشتراك"
            isAllCaps = false
            textSize = 19f
            typeface = BlofyTvDesign.HeadingTypeface
            background = BlofyTvDesign.primaryButton(18f, false)
            setTextColor(BlofyTvDesign.TextPrimary)
            setOnFocusChangeListener { view, focus ->
                view.background = BlofyTvDesign.primaryButton(18f, focus)
            }
            setOnClickListener { activate() }
        }
        panel.addView(activateButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(65)).apply {
            topMargin = dp(18)
        })
        statusView = TextView(this).apply {
            text = "مدة الاشتراك تبدأ عند أول تفعيل ناجح للكود"
            textSize = 13.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(20), dp(6), dp(4))
        }
        panel.addView(statusView)
        codeField.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                activateButton.performClick(); true
            } else false
        }
        activateButton.isFocusable = true
        activateButton.isFocusableInTouchMode = true
        codeField.isFocusable = true
        codeField.isFocusableInTouchMode = true
        codeField.nextFocusDownId = activateButton.id
        activateButton.nextFocusUpId = codeField.id
        setContentView(scroll)
    }

    private fun activate() {
        if (busy) return
        val code = StreamCodeClient.normalizeCode(codeField.text.toString())
        if (code.isBlank()) {
            statusView.text = "الكود أرقام فقط، من 8 إلى 12 رقمًا"
            codeField.requestFocus()
            return
        }
        busy = true
        activateButton.isEnabled = false
        codeField.isEnabled = false
        statusView.text = "جارِ التفعيل عبر BLOFY..."
        lifecycleScope.launch {
            try {
                val deviceKey = StreamCodeSession.installationKey(applicationContext)
                val active = StreamCodeClient.redeem(code, deviceKey)
                withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(applicationContext).dao()
                    val profile = ProviderEntity(StreamCodeSession.providerId,
                        "BLOFY STREAM", StreamCodeSession.HOST,
                        "", "",
                        "xtream", "ts", "http", "media3",
                        true, true, System.currentTimeMillis())
                    // Persist the authenticated session before catalog sync.
                    // If download fails, the same account can retry sync on restart.
                    dao.upsertProvider(profile)
                    dao.disableAllProviders()
                    dao.activateProvider(profile.id)
                    StreamCodeSession.save(applicationContext,active.accessToken,
                        active.activatedAt,active.expiresAt)
                    CatalogSyncState.markPending(applicationContext,profile.id)
                }
                codeField.text?.clear()
                statusView.text = "تم التفعيل • جارِ تجهيز القنوات والأفلام والمسلسلات"
                openCatalog()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                statusView.text = error.message ?: "تعذر التفعيل، حاول مرة أخرى"
                busy = false
                activateButton.isEnabled = true
                codeField.isEnabled = true
                codeField.requestFocus()
            }
        }
    }

    private fun restoreExistingSession() {
        if (busy) return
        busy = true
        activateButton.isEnabled = false
        codeField.isEnabled = false
        statusView.text = "جارِ التحقق من الاشتراك المحفوظ..."
        lifecycleScope.launch {
            try {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val saved = withContext(Dispatchers.IO) {
                    dao.provider(StreamCodeSession.providerId)
                }
                if (saved == null) {
                    StreamCodeSession.clearClaim(applicationContext)
                    statusView.text = "لم يُعثر على بيانات الاشتراك؛ تواصل مع المسؤول"
                } else {
                    val token=StreamCodeSession.token(applicationContext)
                    val valid=if(token==null)false else StreamCodeClient.verifySession(token)
                    when (valid) {
                        true -> {
                            withContext(Dispatchers.IO) {
                                dao.disableAllProviders()
                                dao.activateProvider(saved.id)
                            }
                            val ready = withContext(Dispatchers.IO) {
                                CatalogSyncState.isReady(applicationContext,saved.id) &&
                                    dao.hasCatalog(saved.id)
                            }
                            if (ready) openHome() else openCatalog()
                            return@launch
                        }
                        false -> {
                            StreamCodeSession.clearClaim(applicationContext)
                            statusView.text = "الاشتراك منتهي أو موقوف. أدخل كودًا جديدًا"
                        }
                        null -> statusView.text =
                            "تعذر الاتصال للتحقق من اشتراكك. أعد فتح التطبيق عند توفر الإنترنت"
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                statusView.text = "تعذر التحقق من الاشتراك، تحقق من الإنترنت"
            } finally {
                busy = false
                activateButton.isEnabled = true
                codeField.isEnabled = true
            }
        }
    }

    private fun openCatalog() {
        startActivity(Intent(this, CatalogLoadingActivity::class.java)
            .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, StreamCodeSession.providerId))
        finish()
    }

    private fun openHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    private fun dp(px: Int) = (px * resources.displayMetrics.density).toInt()
}
