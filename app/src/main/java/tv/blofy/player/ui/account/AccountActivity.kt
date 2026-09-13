package tv.blofy.player.ui.account

import android.app.ActivityManager
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.identity.AccountClient
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.ActivationRemoteClient
import tv.blofy.player.core.privacy.PrivacyPreferences
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.common.BlofyTvDesign

/** Available from Login, including expired licenses. Sensitive actions always require a tap. */
class AccountActivity : AppCompatActivity() {
    private lateinit var page: LinearLayout
    private lateinit var status: TextView
    private val actions = mutableListOf<Button>()
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(24), dp(28), dp(32))
        }
        text(getString(R.string.account_title), true)
        text(getString(R.string.privacy_summary))
        action(getString(R.string.privacy_policy)) { openPolicy() }
        page.addView(Switch(this).apply {
            text = getString(R.string.privacy_diagnostics)
            setTextColor(BlofyTvDesign.TextPrimary)
            isChecked = PrivacyPreferences.diagnosticsEnabled(this@AccountActivity)
            setPadding(0, dp(12), 0, dp(12))
            setOnCheckedChangeListener { _, enabled -> PrivacyPreferences.setDiagnostics(this@AccountActivity, enabled) }
        }, LinearLayout.LayoutParams(-1, dp(64)))
        text(getString(R.string.license_recovery_title), true)
        text(getString(R.string.license_recovery_hint))
        action(getString(R.string.license_create_key)) {
            confirm(getString(R.string.license_create_warning)) {
                perform {
                    val result = AccountClient.post(applicationContext, "/api/v1/license/recovery/create")
                    showRecoveryKey(result.getString("recoveryCode"))
                }
            }
        }
        val input = EditText(this).apply {
            hint = getString(R.string.license_enter_key)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            isSingleLine = true
            setTextColor(BlofyTvDesign.TextPrimary)
            setHintTextColor(BlofyTvDesign.TextMuted)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            if (android.os.Build.VERSION.SDK_INT >= 26) importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
        }
        page.addView(input, LinearLayout.LayoutParams(-1, dp(56)))
        action(getString(R.string.license_restore)) {
            val code = input.text.toString().trim()
            if (!code.matches(Regex("[A-Za-z0-9_-]{32}"))) { status.setText(R.string.license_invalid_key); return@action }
            confirm(getString(R.string.license_restore_warning)) {
                perform {
                    refreshActivation()
                    AccountClient.post(applicationContext, "/api/v1/license/recovery/restore", JSONObject().put("recoveryCode", code))
                    input.text.clear()
                    try { refreshActivation() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { }
                    status.setText(R.string.license_restored)
                }
            }
        }
        action(getString(R.string.account_revoke_sessions)) {
            confirm(getString(R.string.account_revoke_warning)) {
                perform { AccountClient.post(applicationContext, "/api/v1/device/sessions/revoke"); status.setText(R.string.account_sessions_revoked) }
            }
        }
        text(getString(R.string.privacy_delete_title), true)
        text(getString(R.string.privacy_delete_warning))
        action(getString(R.string.privacy_delete_title)) {
            confirm(getString(R.string.privacy_delete_warning)) {
                perform {
                    AccountClient.post(applicationContext, "/api/v1/privacy/delete", JSONObject().put("confirmation", "DELETE"))
                    PrivacyPreferences.setDiagnostics(applicationContext, false)
                    status.setText(R.string.privacy_deleted)
                    (getSystemService(ACTIVITY_SERVICE) as ActivityManager).clearApplicationUserData()
                }
            }
        }
        status = text("")
        status.accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        action(getString(R.string.account_back)) { finish() }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            background = AppCompatResources.getDrawable(this@AccountActivity, R.drawable.blofy_home_background)
            addView(page)
        })
        actions.firstOrNull()?.requestFocus()
    }

    private suspend fun refreshActivation() = withContext(Dispatchers.IO) {
        ActivationManager(applicationContext, BlofyDatabase.get(applicationContext).dao())
            .refresh(ActivationRemoteClient.create(BuildConfig.ACTIVATION_BASE_URL), BuildConfig.VERSION_NAME)
    }

    private fun perform(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        actions.forEach { it.isEnabled = false }
        status.setText(R.string.account_wait)
        lifecycleScope.launch {
            try { block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: AccountClient.Failure) {
                status.setText(when (failure.code) {
                    "paid_license_required" -> R.string.license_paid_required
                    "invalid_recovery_code", "recovery_unavailable", "recovery_code_used" -> R.string.license_invalid_key
                    "same_device_recovery" -> R.string.license_same_device
                    "target_already_licensed" -> R.string.license_already_active
                    "unauthorized_device", "rate_limited" -> R.string.account_auth_failed
                    else -> R.string.account_failed
                })
            } catch (_: Exception) { status.setText(R.string.account_failed) }
            finally { busy = false; actions.forEach { it.isEnabled = true } }
        }
    }

    private fun showRecoveryKey(code: String) {
        status.setText(R.string.license_key_created)
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this).setTitle(R.string.license_create_key)
            .setMessage(getString(R.string.license_keep_key) + "\n\n" + code)
            .setPositiveButton(R.string.account_copy) { _, _ ->
                val clip = ClipData.newPlainText("BLOFY recovery", code)
                if (android.os.Build.VERSION.SDK_INT >= 33) clip.description.extras = android.os.PersistableBundle().apply {
                    putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true)
                }
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
            }.setNegativeButton(android.R.string.cancel, null).show()
    }

    private fun openPolicy() {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.ACTIVATION_BASE_URL.trimEnd('/') + "/privacy"))) }
            .onFailure { status.setText(R.string.account_browser_unavailable) }
    }
    private fun confirm(message: String, action: () -> Unit) {
        AlertDialog.Builder(this).setMessage(message).setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(android.R.string.ok) { _, _ -> action() }.show()
    }
    private fun text(value: String, heading: Boolean = false): TextView = TextView(this).apply {
        text = value; textSize = if (heading) 21f else 14f
        typeface = if (heading) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        setTextColor(if (heading) BlofyTvDesign.TextPrimary else BlofyTvDesign.TextMuted)
        setPadding(0, dp(10), 0, dp(10)); gravity = Gravity.START
        page.addView(this, LinearLayout.LayoutParams(-1, -2))
    }
    private fun action(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; isFocusable = true
        setTextColor(BlofyTvDesign.TextPrimary)
        background = BlofyTvDesign.elevatedSurface(dp(14).toFloat())
        BlofyTvDesign.installTvFocus(this, dp(14).toFloat(), 1.015f, false) {}
        setOnClickListener { onClick() }; actions += this
        page.addView(this, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(8) })
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
