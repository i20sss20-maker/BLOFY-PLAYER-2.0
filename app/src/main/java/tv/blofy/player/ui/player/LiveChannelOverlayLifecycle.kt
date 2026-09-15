package tv.blofy.player.ui.player

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.Window
import android.view.WindowManager
import android.widget.Toast
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import java.util.WeakHashMap

/**
 * TV channel browser layered over the existing PlayerActivity window. It deliberately does not
 * start another Activity or player, so the current live session keeps rendering while the list is
 * open. Selecting a row uses PlayerActivity's existing numeric zapping path.
 */
class LiveChannelOverlayLifecycle : Application.ActivityLifecycleCallbacks {
    private val bindings = WeakHashMap<PlayerActivity, LiveWindowCallback>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is PlayerActivity || activity.intent.getStringExtra(PlayerActivity.EXTRA_KIND) != "live") return
        if (bindings.containsKey(activity)) return
        val original = activity.window.callback ?: return
        val wrapped = LiveWindowCallback(activity, original)
        activity.window.callback = wrapped
        bindings[activity] = wrapped
    }

    override fun onActivityPaused(activity: Activity) {
        if (activity !is PlayerActivity) return
        val wrapped = bindings.remove(activity) ?: return
        wrapped.dialog?.dismiss()
        wrapped.dialog = null
        if (activity.window.callback === wrapped) activity.window.callback = wrapped.delegate
    }

    override fun onActivityDestroyed(activity: Activity) = onActivityPaused(activity)
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    private class LiveWindowCallback(
        private val activity: PlayerActivity,
        val delegate: Window.Callback,
    ) : Window.Callback by delegate {
        var dialog: AlertDialog? = null
        private var loading = false

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            val ok = event.action == KeyEvent.ACTION_DOWN &&
                (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER)
            // PlayerActivity gives focus back to PlayerView whenever its HUD is hidden. Intercept
            // only in that state so OK on subtitle/audio/quality controls keeps its old behavior.
            if (ok && activity.currentFocus is PlayerView) {
                openChannelList()
                return true
            }
            return delegate.dispatchKeyEvent(event)
        }

        private fun openChannelList() {
            if (dialog?.isShowing == true || loading || activity.isFinishing || activity.isDestroyed) return
            val providerId = activity.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            val categoryId = activity.intent.getStringExtra(PlayerActivity.EXTRA_CATEGORY_ID)
            if (providerId.isBlank()) return
            loading = true
            activity.lifecycleScope.launch {
                val channels = withContext(Dispatchers.IO) {
                    runCatching {
                        BlofyDatabase.get(activity.applicationContext).dao()
                            .streams(providerId, "live", categoryId).first()
                    }.getOrDefault(emptyList())
                }
                loading = false
                if (activity.isFinishing || activity.isDestroyed) return@launch
                if (channels.isEmpty()) {
                    Toast.makeText(activity, copy("لا توجد قنوات في هذه القائمة", "No channels in this list"), Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val currentKey = RecentChannelStore.keys(activity, providerId).firstOrNull()
                    ?: activity.intent.getStringExtra(PlayerActivity.EXTRA_CONTENT_KEY).orEmpty()
                val checked = channels.indexOfFirst { it.key == currentKey }
                val labels = channels.mapIndexed { index, channel -> "${index + 1}. ${channel.name}" }.toTypedArray()
                val created = AlertDialog.Builder(activity)
                    .setTitle(copy("البث المباشر", "Live channels"))
                    .setSingleChoiceItems(labels, checked) { shown, which ->
                        if (which == checked) {
                            shown.dismiss()
                            return@setSingleChoiceItems
                        }
                        val channelNumber = which + 1
                        if (channelNumber > 9_999) {
                            Toast.makeText(activity, copy("رقم القناة أكبر من حد التبديل الحالي", "Channel number is above the current zap limit"), Toast.LENGTH_SHORT).show()
                            return@setSingleChoiceItems
                        }
                        shown.dismiss()
                        dispatchChannelNumber(channelNumber)
                    }
                    .setNegativeButton(copy("إغلاق", "Close"), null)
                    .setOnDismissListener { dialog = null }
                    .create()
                dialog = created
                created.setOnShowListener {
                    val window = created.window ?: return@setOnShowListener
                    window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                    window.setDimAmount(0.22f)
                    window.setGravity(Gravity.START or Gravity.CENTER_VERTICAL)
                    window.decorView.layoutDirection = activity.resources.configuration.layoutDirection
                    val width = (activity.resources.displayMetrics.widthPixels *
                        if (DeviceClass.isTv(activity)) 0.52f else 0.92f).toInt()
                    window.setLayout(width, WindowManager.LayoutParams.MATCH_PARENT)
                    if (checked >= 0) created.listView.setSelection(checked)
                }
                created.show()
            }
        }

        private fun dispatchChannelNumber(number: Int) {
            number.toString().forEach { digit ->
                val keyCode = when (digit) {
                    '0' -> KeyEvent.KEYCODE_0
                    '1' -> KeyEvent.KEYCODE_1
                    '2' -> KeyEvent.KEYCODE_2
                    '3' -> KeyEvent.KEYCODE_3
                    '4' -> KeyEvent.KEYCODE_4
                    '5' -> KeyEvent.KEYCODE_5
                    '6' -> KeyEvent.KEYCODE_6
                    '7' -> KeyEvent.KEYCODE_7
                    '8' -> KeyEvent.KEYCODE_8
                    '9' -> KeyEvent.KEYCODE_9
                    else -> return@forEach
                }
                activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
            }
        }

        private fun copy(arabic: String, english: String): String =
            if (ConfigurationCompat.getLocales(activity.resources.configuration)[0]?.language == "ar") arabic else english
    }
}
