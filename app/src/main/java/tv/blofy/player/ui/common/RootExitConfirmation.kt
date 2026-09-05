package tv.blofy.player.ui.common

import android.app.Activity
import android.app.Application
import android.app.Dialog
import android.content.DialogInterface
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.DialogFragment
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
                    // showNow closes the rapid-Back race; DialogFragment also survives recreation.
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
            .setTitle("الخروج من BLOFY")
            .setMessage("هل تريد الخروج من التطبيق؟")
            .setPositiveButton("نعم") { _, _ ->
                // Close this task's screens, not the account. Never clear playlists or credentials.
                activity?.finishAffinity()
            }
            .setNegativeButton("لا", null)
            .create()

    override fun onStart() {
        super.onStart()
        val alert = dialog as? AlertDialog ?: return
        alert.setCanceledOnTouchOutside(false)
        val density = resources.displayMetrics.density
        alert.window?.setBackgroundDrawable(BlofyTvDesign.elevatedSurface(24f * density))
        val no = alert.getButton(DialogInterface.BUTTON_NEGATIVE)
        val yes = alert.getButton(DialogInterface.BUTTON_POSITIVE)
        listOf(no, yes).forEach { button ->
            button.isAllCaps = false
            button.isFocusable = true
            button.isFocusableInTouchMode = true
            button.typeface = BlofyTvDesign.BodyTypeface
            button.setTextColor(BlofyTvDesign.TextPrimary)
            BlofyTvDesign.installTvFocus(button, 14f * density, 1.03f, button === no) {}
        }
        no.nextFocusLeftId = yes.id
        no.nextFocusRightId = yes.id
        yes.nextFocusLeftId = no.id
        yes.nextFocusRightId = no.id
        // Safe default: a repeated OK must not accidentally close the application.
        no.post { if (dialog?.isShowing == true) no.requestFocus() }
    }
}
