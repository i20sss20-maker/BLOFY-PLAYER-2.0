package tv.blofy.player.ui.player

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.LiveChannelAdapter
import tv.blofy.player.ui.common.BlofyTvDesign
import java.util.WeakHashMap

/**
 * TV channel browser layered over the existing PlayerActivity window. It never starts another
 * Activity or another player, so the current live session and video surface stay alive while the
 * channel list is open. A channel selection reuses PlayerActivity's existing numeric zapping path.
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
        wrapped.close()
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
        private var dialog: AlertDialog? = null
        private var loading = false
        private var displayedChannels: List<StreamEntity> = emptyList()
        private var currentChannelKey: String? = null

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action != KeyEvent.ACTION_DOWN) return delegate.dispatchKeyEvent(event)
            if (dialog?.isShowing == true && event.keyCode == KeyEvent.KEYCODE_BACK) {
                close()
                return true
            }
            val ok = event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            // PlayerActivity returns focus to PlayerView whenever its HUD is hidden. Intercept OK
            // only then, so audio/subtitle/quality controls retain their established behavior.
            if (ok && dialog?.isShowing != true && (activity.currentFocus is PlayerView || activity.currentFocus == null)) {
                openChannelList()
                return true
            }
            return delegate.dispatchKeyEvent(event)
        }

        fun close() {
            dialog?.dismiss()
            dialog = null
            displayedChannels = emptyList()
            currentChannelKey = null
        }

        private fun openChannelList() {
            if (dialog?.isShowing == true || loading || activity.isFinishing || activity.isDestroyed) return
            val providerId = activity.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            val categoryId = activity.intent.getStringExtra(PlayerActivity.EXTRA_CATEGORY_ID)
            if (providerId.isBlank()) return
            loading = true
            activity.lifecycleScope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        val dao = BlofyDatabase.get(activity.applicationContext).dao()
                        val channels = dao.streams(providerId, "live", categoryId).first()
                        val categoryName = categoryId?.let { id ->
                            dao.categorySnapshot(providerId, "live").firstOrNull { it.remoteId == id }?.name
                        }
                        channels to categoryName
                    }.getOrElse { emptyList<StreamEntity>() to null }
                }
                loading = false
                if (activity.isFinishing || activity.isDestroyed) return@launch
                val channels = result.first
                if (channels.isEmpty()) {
                    Toast.makeText(activity, copy("لا توجد قنوات في هذه القائمة", "No channels in this list"), Toast.LENGTH_SHORT).show()
                    return@launch
                }
                displayedChannels = channels
                currentChannelKey = RecentChannelStore.keys(activity, providerId).firstOrNull()
                    ?: activity.intent.getStringExtra(PlayerActivity.EXTRA_CONTENT_KEY).orEmpty()
                showDialog(result.second)
            }
        }

        private fun showDialog(categoryName: String?) {
            val channels = displayedChannels
            if (channels.isEmpty() || activity.isFinishing || activity.isDestroyed) return
            val list = RecyclerView(activity).apply {
                layoutManager = LinearLayoutManager(activity)
                itemAnimator = null
                clipToPadding = false
                setPadding(dp(6), dp(6), dp(6), dp(10))
                setItemViewCacheSize(18)
                recycledViewPool.setMaxRecycledViews(0, 24)
                overScrollMode = View.OVER_SCROLL_NEVER
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setBackgroundColor(Color.TRANSPARENT)
                alpha = .97f
            }
            val adapter = LiveChannelAdapter(
                onClick = { channel -> selectChannel(channel) },
                onFocus = {},
                onLongClick = {},
                itemKey = { it.key }
            )
            adapter.submit(channels)
            list.adapter = adapter

            val header = TextView(activity).apply {
                text = buildString {
                    append(copy("البث المباشر", "Live channels"))
                    if (!categoryName.isNullOrBlank()) append("  •  ").append(categoryName)
                }
                textSize = 18f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(8), dp(14), dp(2))
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val hint = TextView(activity).apply {
                text = copy(
                    "القناة مستمرة بالخلفية  •  OK للتبديل  •  BACK للإغلاق",
                    "Channel keeps playing  •  OK to switch  •  BACK to close"
                )
                textSize = 10.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(14), 0, dp(14), dp(5))
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val panel = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = activity.resources.configuration.layoutDirection
                background = GradientDrawable().apply {
                    cornerRadius = dp(18).toFloat()
                    // Glass-like surface: video remains visible instead of being covered by an
                    // almost opaque panel.
                    setColor(0xD616121E.toInt())
                    setStroke(dp(1), 0x805D3A83.toInt())
                }
                elevation = dp(12).toFloat()
                addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)))
                addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(32)))
                addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            }

            val created = AlertDialog.Builder(activity)
                .setView(panel)
                .create()
            created.setCanceledOnTouchOutside(false)
            created.setOnDismissListener {
                if (dialog === created) dialog = null
                displayedChannels = emptyList()
                currentChannelKey = null
            }
            dialog = created
            created.setOnShowListener {
                val window = created.window ?: return@setOnShowListener
                window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                window.setDimAmount(0.06f)
                window.setGravity(Gravity.START or Gravity.CENTER_VERTICAL)
                window.decorView.layoutDirection = activity.resources.configuration.layoutDirection
                window.setBackgroundDrawableResource(android.R.color.transparent)
                val device = DeviceClass.detect(activity)
                val widthRatio = when (device) {
                    DeviceClass.Kind.TV -> 0.36f
                    DeviceClass.Kind.TABLET -> 0.52f
                    DeviceClass.Kind.PHONE -> 0.88f
                }
                val heightRatio = when (device) {
                    DeviceClass.Kind.TV -> 0.82f
                    DeviceClass.Kind.TABLET -> 0.86f
                    DeviceClass.Kind.PHONE -> 0.88f
                }
                val width = (activity.resources.displayMetrics.widthPixels * widthRatio).toInt()
                val height = (activity.resources.displayMetrics.heightPixels * heightRatio).toInt()
                window.setLayout(width, height)
                val current = currentChannelKey
                val currentIndex = channels.indexOfFirst { it.key == current }.coerceAtLeast(0)
                list.scrollToPosition(currentIndex)
                list.post {
                    list.findViewHolderForAdapterPosition(currentIndex)?.itemView?.requestFocus()
                        ?: list.requestFocus()
                }
            }
            created.show()
        }

        private fun selectChannel(channel: StreamEntity) {
            if (channel.key == currentChannelKey) return
            val which = displayedChannels.indexOfFirst { it.key == channel.key }
            if (which < 0) return
            val channelNumber = which + 1
            if (channelNumber > 9_999) {
                Toast.makeText(
                    activity,
                    copy("رقم القناة أكبر من حد التبديل الحالي", "Channel number is above the current zap limit"),
                    Toast.LENGTH_SHORT
                ).show()
                return
            }
            val switchAction = {
                currentChannelKey = channel.key
                dispatchChannelNumber(channelNumber)
            }
            if (channel.locked) ParentalGate.requirePin(activity, switchAction) else switchAction()
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

        private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

        private fun copy(arabic: String, english: String): String =
            if (ConfigurationCompat.getLocales(activity.resources.configuration)[0]?.language == "ar") arabic else english
    }
}
