package tv.blofy.player.ui.settings

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

class ParentalSettingsActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var setButton: Button
    private lateinit var clearButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildPage()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshState()
    }

    private fun buildPage() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.TOP or Gravity.START
            setPadding(dp(42), dp(32), dp(42), dp(36))
            background = AppCompatResources.getDrawable(this@ParentalSettingsActivity, R.drawable.blofy_home_background)
        }
        root.addView(Button(this).apply {
            text = getString(R.string.back)
            CinemaStyle.styleButton(this)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(110), dp(44)).apply { gravity = Gravity.START; bottomMargin = dp(14) })
        root.addView(TextView(this).apply {
            text = getString(R.string.parental_title)
            textSize = 28f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.parental_subtitle)
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            setPadding(0, dp(8), 0, dp(20))
        })
        status = TextView(this).apply {
            textSize = 15f
            typeface = BlofyTvDesign.MediumTypeface
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(18), 0, dp(18), 0)
            background = CinemaStyle.surface(this@ParentalSettingsActivity)
        }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(16) })

        setButton = actionButton("") {
            if (ParentalGate.hasPin(this)) {
                ParentalGate.requirePin(this) { promptNewPin(R.string.parental_change_pin) }
            } else {
                promptNewPin(R.string.parental_set_pin)
            }
        }
        root.addView(setButton, LinearLayout.LayoutParams(-1, dp(56)).apply { bottomMargin = dp(10) })

        clearButton = actionButton(getString(R.string.parental_clear_pin)) {
            if (!ParentalGate.hasPin(this)) return@actionButton
            ParentalGate.requirePin(this) {
                AlertDialog.Builder(this)
                    .setTitle(R.string.parental_disable_title)
                    .setMessage(R.string.parental_disable_message)
                    .setPositiveButton(R.string.parental_clear_pin) { _, _ ->
                        ParentalGate.clearPin(this)
                        refreshState()
                    }
                    .setNegativeButton(R.string.parental_back, null)
                    .show()
            }
        }
        root.addView(clearButton, LinearLayout.LayoutParams(-1, dp(56)))
        setContentView(root)
        refreshState()
    }

    private fun refreshState() {
        val enabled = ParentalGate.hasPin(this)
        status.text = getString(if (enabled) R.string.parental_enabled else R.string.parental_not_set)
        status.setTextColor(if (enabled) BlofyTvDesign.Mint else BlofyTvDesign.TextMuted)
        setButton.text = getString(if (enabled) R.string.parental_change_pin else R.string.parental_set_pin)
        clearButton.isEnabled = enabled
        clearButton.alpha = if (enabled) 1f else .45f
    }

    private fun promptNewPin(titleRes: Int) {
        val first = pinField(getString(R.string.parental_new_pin_hint))
        AlertDialog.Builder(this)
            .setTitle(titleRes)
            .setMessage(R.string.parental_enter_digits)
            .setView(first)
            .setPositiveButton(R.string.parental_next, null)
            .setNegativeButton(R.string.parental_cancel, null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val pin = first.text?.toString().orEmpty().trim()
                        if (!validPin(pin)) {
                            first.error = getString(R.string.parental_invalid_pin)
                            return@setOnClickListener
                        }
                        dialog.dismiss()
                        confirmPin(pin)
                    }
                }
                dialog.show()
            }
    }

    private fun confirmPin(pin: String) {
        val confirm = pinField(getString(R.string.parental_confirm_pin_hint))
        AlertDialog.Builder(this)
            .setTitle(R.string.parental_confirm_title)
            .setView(confirm)
            .setPositiveButton(R.string.parental_save, null)
            .setNegativeButton(R.string.parental_cancel, null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        if (confirm.text?.toString().orEmpty().trim() != pin) {
                            confirm.error = getString(R.string.parental_mismatch)
                            return@setOnClickListener
                        }
                        if (!ParentalGate.setPin(this, pin)) {
                            confirm.error = getString(R.string.parental_save_failed)
                            return@setOnClickListener
                        }
                        dialog.dismiss()
                        refreshState()
                    }
                }
                dialog.show()
            }
    }

    private fun pinField(hintText: String) = EditText(this).apply {
        hint = hintText
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        isSingleLine = true
        textAlignment = View.TEXT_ALIGNMENT_CENTER
    }

    private fun validPin(value: String) = value.length in 4..8 && value.all(Char::isDigit)

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        CinemaStyle.styleButton(this)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
