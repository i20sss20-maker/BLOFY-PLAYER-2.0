package tv.blofy.player.ui.common

import android.app.Activity
import android.app.Application
import android.app.Dialog
import android.content.DialogInterface
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.DialogFragment
import tv.blofy.player.R
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.LoginActivity

/** Root screens confirm exit; every content/player screen retains its existing Back behavior. */
class RootExitConfirmationLifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is AppCompatActivity && isRootScreen(activity.javaClass)) install(activity)
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit

    companion object {
        internal const val DIALOG_TAG = "blofy_root_exit_confirmation"

        internal fun isRootScreen(type: Class<*>): Boolean =
            type == HomeActivity::class.java || type == LoginActivity::class.java

        internal fun install(activity: AppCompatActivity) {
            activity.onBackPressedDispatcher.addCallback(activity, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val fragments = activity.supportFragmentManager
                    if (activity.isFinishing || activity.isDestroyed || fragments.isStateSaved) return
                    if (fragments.findFragmentByTag(DIALOG_TAG) == null) {
                        RootExitConfirmationDialog().showNow(fragments, DIALOG_TAG)
                    }
                }
            })
        }
    }
}

class RootExitConfirmationDialog : DialogFragment() {
    private lateinit var choices: LinearLayout

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val context = requireContext()
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(24), dp(26), dp(24), dp(24))
            addView(TextView(context).apply {
                text = "BLOFY"
                typeface = BlofyTvDesign.HeadingTypeface
                textSize = 13f
                letterSpacing = .16f
                setTextColor(CinemaStyle.Accent)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, -2))
            addView(TextView(context).apply {
                setText(R.string.exit_title)
                typeface = BlofyTvDesign.HeadingTypeface
                textSize = 23f
                setTextColor(CinemaStyle.White)
                gravity = Gravity.CENTER
                setPadding(0, dp(14), 0, dp(8))
            }, LinearLayout.LayoutParams(-1, -2))
            addView(TextView(context).apply {
                id = android.R.id.message
                setText(R.string.exit_message)
                typeface = BlofyTvDesign.BodyTypeface
                textSize = 15f
                setTextColor(CinemaStyle.Muted)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, -2))
        }
        choices = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            clipChildren = false
            clipToPadding = false
        }
        body.addView(choices, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(22) })
        return AlertDialog.Builder(context)
            .setView(body, 0, 0, 0, 0)
            .setPositiveButton(R.string.exit_confirm) { _, _ -> activity?.finishAffinity() }
            .setNegativeButton(R.string.exit_stay, null)
            .create()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onStart() {
        super.onStart()
        val alert = dialog as? AlertDialog ?: return
        alert.setCanceledOnTouchOutside(false)
        val density = resources.displayMetrics.density
        alert.window?.setBackgroundDrawable(CinemaStyle.surface(requireContext(), radiusDp = 24))
        alert.window?.setDimAmount(.78f)
        alert.window?.setLayout(minOf(dp(440), resources.displayMetrics.widthPixels - dp(32)), ViewGroup.LayoutParams.WRAP_CONTENT)
        val no = alert.getButton(DialogInterface.BUTTON_NEGATIVE)
        val yes = alert.getButton(DialogInterface.BUTTON_POSITIVE)

        if (no.id == View.NO_ID) no.id = View.generateViewId()
        if (yes.id == View.NO_ID) yes.id = View.generateViewId()

        // Reuse AlertDialog's actions and dismiss semantics, with our own equal-width row.
        alert.findViewById<View>(androidx.appcompat.R.id.buttonPanel)?.visibility = View.GONE
        listOf(no, yes).forEach { button ->
            (button.parent as? ViewGroup)?.removeView(button)
            choices.addView(button, LinearLayout.LayoutParams(0, dp(56), 1f).apply {
                marginStart = dp(4); marginEnd = dp(4)
            })
            button.isAllCaps = false
            button.isFocusable = true
            button.isFocusableInTouchMode = true
            button.typeface = BlofyTvDesign.BodyTypeface
            button.textSize = 15f
            button.gravity = Gravity.CENTER
            button.stateListAnimator = null
            button.backgroundTintList = null
            button.minWidth = 0
            button.minimumWidth = 0
            button.minHeight = 0
            button.setPadding(dp(6), 0, dp(6), 0)
            button.setSingleLine(false)
            button.maxLines = 2
            fun render(focused: Boolean) {
                button.background = GradientDrawable().apply {
                    cornerRadius = 14 * density
                    setColor(if (focused) Color.WHITE else CinemaStyle.Surface)
                    setStroke(((if (focused) 2 else 1) * density).toInt(), if (focused) Color.WHITE else 0x80FFFFFF.toInt())
                }
                button.setTextColor(if (focused) CinemaStyle.Background else CinemaStyle.White)
            }
            render(button.hasFocus())
            button.setOnFocusChangeListener { view, focused ->
                render(focused)
                view.animate().cancel()
                view.animate().scaleX(if (focused) 1.02f else 1f).scaleY(if (focused) 1.02f else 1f)
                    .setDuration(if (focused) 90 else 70).start()
            }
        }

        no.nextFocusLeftId = yes.id
        no.nextFocusRightId = yes.id
        yes.nextFocusLeftId = no.id
        yes.nextFocusRightId = no.id

        no.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
                if (event.repeatCount == 0) yes.requestFocus()
                true
            } else false
        }
        yes.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
                if (event.repeatCount == 0) no.requestFocus()
                true
            } else false
        }

        no.post { if (dialog?.isShowing == true) no.requestFocus() }
    }
}
