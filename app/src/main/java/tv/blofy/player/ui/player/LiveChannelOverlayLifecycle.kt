package tv.blofy.player.ui.player

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.content.Intent
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
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.RemoteAction
import tv.blofy.player.core.remote.RemoteKeyRouter
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.browser.LiveChannelAdapter
import tv.blofy.player.ui.common.BlofyTvDesign
import java.util.WeakHashMap

/**
 * Compact channel browser layered over the existing PlayerActivity window.
 *
 * Opening this overlay never creates another player or playback Activity. The current live surface
 * stays attached and keeps rendering while the channel list is visible. Channel selection reuses
 * PlayerActivity's established numeric zapping path instead of introducing a second playback path.
 */
class LiveChannelOverlayLifecycle : Application.ActivityLifecycleCallbacks {
    private val bindings = WeakHashMap<PlayerActivity, LiveWindowCallback>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is PlayerActivity || activity.intent.getStringExtra(PlayerActivity.EXTRA_KIND) != KIND_LIVE) return

        val existing = bindings[activity]
        if (existing != null && activity.window.callback === existing) return
        existing?.close()

        val original = activity.window.callback ?: return
        val wrapped = LiveWindowCallback(activity, original)
        activity.window.callback = wrapped
        bindings[activity] = wrapped
    }

    override fun onActivityPaused(activity: Activity) {
        if (activity !is PlayerActivity) return
        // A temporary pause (guide, system overlay, focus hand-off) must not detach the callback.
        // Detaching here created a race where BACK/OK could fall through to PlayerActivity and
        // produce a different result after resume. Keep one live routing callback for the entire
        // PlayerActivity lifetime; only dismiss the transient channel dialog while paused.
        bindings[activity]?.close()
    }

    override fun onActivityDestroyed(activity: Activity) {
        if (activity !is PlayerActivity) return
        val wrapped = bindings.remove(activity) ?: return
        wrapped.close()
        if (activity.window.callback === wrapped) activity.window.callback = wrapped.delegate
    }

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
            val routed = RemoteKeyRouter.route(event)

            if (routed.action == RemoteAction.BACK) {
                if (dialog?.isShowing == true) {
                    close()
                } else {
                    returnToLiveBrowser()
                }
                return true
            }

            // Live fullscreen has one deterministic OK contract: one press opens the channel list.
            // Do not depend on whichever hidden HUD control happened to own focus, otherwise the
            // first OK can fall through to PlayerActivity and only the second press opens this list.
            if (routed.action == RemoteAction.OK && dialog?.isShowing != true) {
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

        private fun returnToLiveBrowser() {
            if (activity.isFinishing || activity.isDestroyed) return
            val providerId = activity.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            if (providerId.isNotBlank()) {
                val categoryId = activity.intent.getStringExtra(PlayerActivity.EXTRA_CATEGORY_ID)
                val channelKey = RecentChannelStore.keys(activity, providerId).firstOrNull()
                    ?: activity.intent.getStringExtra(PlayerActivity.EXTRA_CONTENT_KEY).orEmpty()
                activity.getSharedPreferences(BROWSER_STATE_PREFS, Activity.MODE_PRIVATE)
                    .edit()
                    .putString("$providerId:live:last_category", categoryId)
                    .putString("$providerId:live:last_stream", channelKey.takeIf { it.isNotBlank() })
                    .apply()
            }

            // Mark this route so the generic finish lifecycle does not launch a duplicate screen.
            activity.intent.putExtra(PlayerReturnNavigationLifecycle.EXTRA_RETURN_ALREADY_ROUTED, true)
            activity.startActivity(Intent(activity, ContentBrowserActivity::class.java).apply {
                putExtra(ContentBrowserActivity.EXTRA_KIND, KIND_LIVE)
                addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            })
            activity.finish()
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
                        val channels = dao.streams(providerId, KIND_LIVE, categoryId).first()
                        val categoryName = categoryId?.let { id ->
                            dao.categorySnapshot(providerId, KIND_LIVE).firstOrNull { it.remoteId == id }?.name
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
                setPadding(dp(4), dp(3), dp(4), dp(5))
                setItemViewCacheSize(18)
                recycledViewPool.setMaxRecycledViews(0, 24)
                overScrollMode = View.OVER_SCROLL_NEVER
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setBackgroundColor(Color.TRANSPARENT)
            }
            val adapter = LiveChannelAdapter(
                onClick = { channel -> selectChannel(channel) },
                onFocus = {},
                onLongClick = {},
                itemKey = { it.key },
                translucent = true
            )
            adapter.submit(channels)
            list.adapter = adapter

            val header = TextView(activity).apply {
                text = buildString {
                    append(copy("البث المباشر", "Live channels"))
                    if (!categoryName.isNullOrBlank()) append("  •  ").append(categoryName)
                }
                textSize = 14.5f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.TextPrimary)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(4), dp(10), 0)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val hint = TextView(activity).apply {
                text = copy(
                    "البث مستمر  •  OK للتبديل  •  BACK للإغلاق",
                    "Live keeps playing  •  OK switch  •  BACK close"
                )
                textSize = 8.7f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(10), 0, dp(10), dp(2))
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val panel = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = activity.resources.configuration.layoutDirection
                background = GradientDrawable().apply {
                    cornerRadius = dp(16).toFloat()
                    // Intentionally translucent: the current video remains clearly visible behind
                    // the compact list instead of looking like playback was replaced by a menu.
                    setColor(0x7416121E.toInt())
                    setStroke(dp(1), 0x4D7956A8.toInt())
                }
                elevation = dp(7).toFloat()
                addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
                addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)))
                addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            }

            val device = DeviceClass.detect(activity)
            val widthRatio = when (device) {
                DeviceClass.Kind.TV -> 0.24f
                DeviceClass.Kind.TABLET -> 0.38f
                DeviceClass.Kind.PHONE -> 0.78f
            }
            val heightRatio = when (device) {
                DeviceClass.Kind.TV -> 0.58f
                DeviceClass.Kind.TABLET -> 0.66f
                DeviceClass.Kind.PHONE -> 0.76f
            }
            val width = (activity.resources.displayMetrics.widthPixels * widthRatio).toInt()
            val height = (activity.resources.displayMetrics.heightPixels * heightRatio).toInt()

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

            // Configure placement before show so there is no first-frame center position followed
            // by a second layout pass on the left. LEFT is intentional and independent of Arabic
            // RTL layout; only the panel contents follow the app's text direction.
            created.window?.let { window ->
                prepareWindow(window, width, height, reveal = false)
            }
            created.setOnShowListener {
                val window = created.window ?: return@setOnShowListener
                prepareWindow(window, width, height, reveal = true)
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

        private fun prepareWindow(window: Window, width: Int, height: Int, reveal: Boolean) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setDimAmount(0f)
            window.setWindowAnimations(0)
            window.setBackgroundDrawableResource(android.R.color.transparent)
            window.setGravity(PANEL_GRAVITY)
            window.decorView.layoutDirection = activity.resources.configuration.layoutDirection
            if (!reveal) window.decorView.alpha = 0f

            val attributes = window.attributes
            attributes.gravity = PANEL_GRAVITY
            attributes.width = width
            attributes.height = height
            attributes.x = dp(10)
            window.attributes = attributes
            window.setLayout(width, height)

            if (reveal) {
                // Post one frame after final geometry is committed. The user never sees the
                // AlertDialog's default centered geometry during its first open.
                window.decorView.post { window.decorView.alpha = 1f }
            }
        }

        private fun selectChannel(channel: StreamEntity) {
            val playingKey = RecentChannelStore.keys(activity, channel.providerId).firstOrNull() ?: currentChannelKey
            if (channel.key == playingKey) return
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
                dispatchChannelNumber(channelNumber)
            }
            switchAction() // PlayerActivity checks the same gate for digits, arrows and this overlay.
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

    private companion object {
        const val KIND_LIVE = "live"
        const val BROWSER_STATE_PREFS = "blofy_browser_state"
        const val PANEL_GRAVITY = Gravity.LEFT or Gravity.CENTER_VERTICAL
    }
}
