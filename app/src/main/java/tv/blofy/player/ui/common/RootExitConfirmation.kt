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
    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog =
        AlertDialog.Builder(requireContext())
            .setTitle(R.string.exit_title)
            .setMessage(R.string.exit_message)
            .setPositiveButton(R.string.yes) { _, _ -> activity?.finishAffinity() }
            .setNegativeButton(R.string.no, null)
            .create()

    override fun onStart() {
        super.onStart()
        val alert = dialog as? AlertDialog ?: return
        alert.setCanceledOnTouchOutside(false)
        val density = resources.displayMetrics.density
        alert.window?.setBackgroundDrawable(CinemaStyle.surface(requireContext(), radiusDp = 20))
        alert.window?.setDimAmount(.72f)
        val screenWidth = resources.displayMetrics.widthPixels
        alert.window?.setLayout(minOf((460 * density).toInt(), screenWidth - (40 * density).toInt()), ViewGroup.LayoutParams.WRAP_CONTENT)
        alert.findViewById<TextView>(android.R.id.message)?.apply {
            setTextColor(CinemaStyle.Muted)
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(0, (12 * density).toInt(), 0, (20 * density).toInt())
        }
        alert.findViewById<TextView>(androidx.appcompat.R.id.alertTitle)?.apply {
            setTextColor(CinemaStyle.White)
            textSize = 24f
        }
        val no = alert.getButton(DialogInterface.BUTTON_NEGATIVE)
        val yes = alert.getButton(DialogInterface.BUTTON_POSITIVE)

        if (no.id == View.NO_ID) no.id = View.generateViewId()
        if (yes.id == View.NO_ID) yes.id = View.generateViewId()

        listOf(no, yes).forEach { button ->
            button.isAllCaps = false
            button.isFocusable = true
            button.isFocusableInTouchMode = true
            button.typeface = BlofyTvDesign.BodyTypeface
            button.textSize = 17f
            button.gravity = Gravity.CENTER
            button.stateListAnimator = null
            button.backgroundTintList = null
            button.layoutParams = (button.layoutParams as LinearLayout.LayoutParams).apply {
                width = 0
                height = (54 * density).toInt()
                weight = 1f
                setMargins((6 * density).toInt(), (8 * density).toInt(), (6 * density).toInt(), (8 * density).toInt())
            }
            fun render(focused: Boolean) {
                button.background = GradientDrawable().apply {
                    cornerRadius = 10 * density
                    setColor(if (focused) Color.WHITE else CinemaStyle.Surface)
                    setStroke(((if (focused) 2 else 1) * density).toInt(), if (focused) Color.WHITE else 0x80FFFFFF.toInt())
                }
                button.setTextColor(if (focused) CinemaStyle.Background else CinemaStyle.White)
            }
            render(button.hasFocus())
            button.setOnFocusChangeListener { _, focused -> render(focused) }
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
