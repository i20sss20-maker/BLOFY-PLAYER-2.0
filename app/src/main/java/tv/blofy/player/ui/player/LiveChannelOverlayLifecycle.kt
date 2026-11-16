package tv.blofy.player.ui.player

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.text.ArabicSearchNormalizer
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
        private var originalChannels: List<StreamEntity> = emptyList()
        private var activeTab: LiveChannelTab = LiveChannelTab.ALL
        private var searchText: String = ""
        private var filterJob: Job? = null
        private var visibleAdapter: LiveChannelAdapter? = null
        private var visibleCount: TextView? = null
        // A single in-panel selection state. BACK returns to channel controls
        // instead of exiting player or opening another file/library screen.
        private var audioPickerOpen = false
        private var restoreMainActions: (() -> Unit)? = null

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action != KeyEvent.ACTION_DOWN) return delegate.dispatchKeyEvent(event)
            if (dialog?.isShowing == true && RemoteKeyRouter.route(event).action == RemoteAction.BACK) {
                if (audioPickerOpen) restoreMainActions?.invoke()
                else close()
                return true
            }

            // The QuickMenu interceptor deliberately leaves live PlayerActivity
            // alone. One owner of the remote keys avoids nested callback races
            // and makes audio reachable without stopping playback.
            return when (LivePlayerMenuPolicy.action(
                event.keyCode,
                hudVisible = activity.liveControlsVisible(),
                channelDialogVisible = dialog?.isShowing == true,
                unifiedChannelPanel = BuildConfig.CODE_ONLY_LOGIN
            )) {
                LivePlayerMenuAction.SHOW_AUDIO_CONTROLS ->
                    if (activity.showLiveAudioControls()) true else delegate.dispatchKeyEvent(event)
                LivePlayerMenuAction.SHOW_CHANNEL_LIST -> {
                    activity.dismissLiveAudioControls()
                    openChannelList()
                    true
                }
                LivePlayerMenuAction.DISMISS_CONTROLS -> {
                    activity.dismissLiveAudioControls()
                    true
                }
                LivePlayerMenuAction.RETURN_TO_BROWSER -> {
                    returnToLiveBrowser()
                    true
                }
                LivePlayerMenuAction.PASS_THROUGH -> delegate.dispatchKeyEvent(event)
            }
        }

        fun close() {
            audioPickerOpen = false
            restoreMainActions = null
            filterJob?.cancel()
            filterJob = null
            dialog?.dismiss()
            dialog = null
            displayedChannels = emptyList()
            originalChannels = emptyList()
            visibleAdapter = null
            visibleCount = null
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
            if (providerId.isBlank()) {
                Toast.makeText(activity, copy(
                    "تعذر معرفة قائمة القنوات. افتح الصوتيات من زر القائمة.",
                    "Channel list unavailable. Press MENU for audio controls."
                ), Toast.LENGTH_SHORT).show()
                return
            }
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
                originalChannels = channels
                activeTab = LiveChannelTab.ALL
                searchText = ""
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
            var lastFocusedChannelKey: String? = null
            val adapter = LiveChannelAdapter(
                onClick = { channel -> selectChannel(channel) },
                onFocus = { lastFocusedChannelKey = it.key },
                onLongClick = { channel ->
                    activity.lifecycleScope.launch {
                        val dao = BlofyDatabase.get(activity.applicationContext).dao()
                        val item = dao.stream(channel.key) ?: return@launch
                        dao.setFavorite(channel.key, !item.favorite)
                        Toast.makeText(activity,
                            if (!item.favorite) copy("أضيفت للمفضلة", "Added to favorites")
                            else copy("أزيلت من المفضلة", "Removed from favorites"),
                            Toast.LENGTH_SHORT).show()
                        if (activeTab == LiveChannelTab.FAVORITES) refreshList()
                    }
                },
                itemKey = { it.key },
                translucent = true,
                highContrast = true
            )
            adapter.submit(channels)
            list.adapter = adapter
            visibleAdapter = adapter

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
                    "→ الصوت مباشرة  •  OK تشغيل  •  BACK إغلاق",
                    "RIGHT audio  •  OK tune  •  BACK close"
                )
                textSize = 10f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(10), 0, dp(10), dp(2))
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val searchField = if (BuildConfig.CODE_ONLY_LOGIN) EditText(activity).apply {
                this.hint = copy("بحث في جميع القنوات…", "Search all channels…")
                contentDescription = this.hint
                textSize = 13.5f
                setSingleLine(true)
                inputType = InputType.TYPE_CLASS_TEXT
                setTextColor(Color.WHITE)
                setHintTextColor(0xFFB7ABC5.toInt())
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = GradientDrawable().apply {
                    cornerRadius = dp(12).toFloat()
                    setColor(0xEF1A1527.toInt())
                    setStroke(dp(1), 0x7B6D508D)
                }
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        searchText = s?.toString().orEmpty().take(80)
                        refreshList()
                    }
                    override fun afterTextChanged(s: Editable?) = Unit
                })
            } else null
            val tabs = LinearLayout(activity).apply {
                val tabContainer = this
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = activity.resources.configuration.layoutDirection
                gravity = Gravity.CENTER
                setPadding(dp(6), 0, dp(6), 0)
                if (BuildConfig.CODE_ONLY_LOGIN) {
                    val options = listOf(
                        LiveChannelTab.ALL to if (activity.intent.getStringExtra(PlayerActivity.EXTRA_CATEGORY_ID) == null)
                            copy("الكل", "All") else copy("القسم", "Category"),
                        LiveChannelTab.FAVORITES to copy("★ المفضلة", "★ Favorites"),
                        LiveChannelTab.RECENT to copy("◷ الأخيرة", "◷ Recent")
                    )
                    options.forEach { (tab, caption) ->
                        addView(TextView(activity).apply {
                            text = caption
                            contentDescription = caption
                            textSize = 11.7f
                            gravity = Gravity.CENTER
                            setTextColor(Color.WHITE)
                            isFocusable = true
                            isClickable = true
                            background = GradientDrawable().apply {
                                cornerRadius = dp(10).toFloat()
                                setColor(if (tab == activeTab) 0xFF5A3384.toInt() else 0xE52C2538.toInt())
                            }
                            setOnClickListener {
                                activeTab = tab
                                for (index in 0 until tabContainer.childCount) {
                                    tabContainer.getChildAt(index)?.background = GradientDrawable().apply {
                                        cornerRadius = dp(10).toFloat()
                                        setColor(if (index == options.indexOfFirst { it.first == tab })
                                            0xFF5A3384.toInt() else 0xE52C2538.toInt())
                                    }
                                }
                                refreshList()
                            }
                        }, LinearLayout.LayoutParams(0, dp(36), 1f).apply {
                            marginStart = dp(2); marginEnd = dp(2)
                        })
                    }
                }
            }
            val count = TextView(activity).apply {
                text = copy("${channels.size} قناة", "${channels.size} channels")
                textSize = 10.5f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setPadding(dp(12), 0, dp(12), 0)
            }
            visibleCount = count

            val panel = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = activity.resources.configuration.layoutDirection
                background = GradientDrawable().apply {
                    cornerRadius = dp(16).toFloat()
                    // Intentionally translucent: the current video remains clearly visible behind
                    // the compact list instead of looking like playback was replaced by a menu.
                    setColor(0xF216121E.toInt())
                    setStroke(dp(1), 0x4D7956A8.toInt())
                }
                elevation = dp(7).toFloat()
                addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)))
                addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(19)))
                if (BuildConfig.CODE_ONLY_LOGIN) {
                    searchField?.let { addView(it, LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(42)).apply {
                            marginStart = dp(7); marginEnd = dp(7); bottomMargin = dp(5)
                        }) }
                    addView(tabs, LinearLayout.LayoutParams(-1, dp(36)))
                    addView(count, LinearLayout.LayoutParams(-1, dp(17)))
                }
                // Channel rows scroll above the controls. Both are in this one
                // translucent panel, not in separate floating HUD windows.
                addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                if (BuildConfig.CODE_ONLY_LOGIN) {
                    // Reserve a fixed, scrollable remote-control footer so 38
                    // direct audio buttons never shrink the channel list.
                    val actions = buildAttachedActions {
                        val visible = (list.layoutManager as? LinearLayoutManager)
                            ?.findFirstVisibleItemPosition()?.coerceAtLeast(0) ?: 0
                        val target = adapter.indexOfKey(lastFocusedChannelKey)
                            .takeIf { it >= 0 } ?: visible
                        list.scrollToPosition(target)
                        list.post {
                            list.findViewHolderForAdapterPosition(target)?.itemView?.requestFocus()
                                ?: list.requestFocus()
                        }
                    }
                    list.addOnChildAttachStateChangeListener(object : RecyclerView.OnChildAttachStateChangeListener {
                        override fun onChildViewAttachedToWindow(view: View) {
                            view.setOnKeyListener { _, keyCode, event ->
                                if (event.action == KeyEvent.ACTION_DOWN &&
                                    keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                                    (actions.tag as? View)?.requestFocus() == true
                                } else false
                            }
                        }
                        override fun onChildViewDetachedFromWindow(view: View) = Unit
                    })
                    addView(actions, LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(76)))
                }
            }

            val device = DeviceClass.detect(activity)
            // Keep the legacy BLOFY PLAYER layout unchanged. STREAM gives
            // the joined vertical controls enough width and channel-row space.
            val (widthRatio, heightRatio) =
                if (BuildConfig.CODE_ONLY_LOGIN) LiveChannelPanelPolicy.dimensions(
                    isTv = device == DeviceClass.Kind.TV,
                    isTablet = device == DeviceClass.Kind.TABLET
                )
                else when (device) {
                    DeviceClass.Kind.TV -> 0.24f to 0.58f
                    DeviceClass.Kind.TABLET -> 0.38f to 0.66f
                    DeviceClass.Kind.PHONE -> 0.78f to 0.76f
                }
            val width = (activity.resources.displayMetrics.widthPixels * widthRatio).toInt()
            val height = (activity.resources.displayMetrics.heightPixels * heightRatio).toInt()

            val created = AlertDialog.Builder(activity)
                .setView(panel)
                .create()
            created.setCanceledOnTouchOutside(false)
            // Dialogs own focus on Android TV; activity's Window.Callback is
            // not guaranteed to see BACK while the joined panel is open.
            // One BACK returns to controls, the next dismisses the sidebar.
            var consumeBackRelease = false
            created.setOnKeyListener { _, keyCode, event ->
                if (keyCode != KeyEvent.KEYCODE_BACK) false
                else when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (audioPickerOpen) {
                            consumeBackRelease = true
                            restoreMainActions?.invoke()
                            true
                        } else false
                    }
                    KeyEvent.ACTION_UP -> {
                        if (consumeBackRelease) {
                            consumeBackRelease = false
                            true // Do not also dismiss the sidebar on key-up.
                        } else false
                    }
                    else -> false
                }
            }
            created.setOnDismissListener {
                if (dialog === created) dialog = null
                filterJob?.cancel()
                audioPickerOpen = false
                restoreMainActions = null
                visibleAdapter = null
                visibleCount = null
                displayedChannels = emptyList()
                originalChannels = emptyList()
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

        /** Search is bounded and debounced. Favorites and recents are resolved
         * from the user's real local provider rows, never invented remote URLs. */
        private fun refreshList() {
            val openDialog = dialog ?: return
            val adapter = visibleAdapter ?: return
            val providerId = activity.intent.getStringExtra(PlayerActivity.EXTRA_PROVIDER_ID).orEmpty()
            if (providerId.isBlank()) return
            val query = searchText
            val tab = activeTab
            val base = originalChannels
            filterJob?.cancel()
            filterJob = activity.lifecycleScope.launch {
                delay(160)
                val filtered = withContext(Dispatchers.IO) {
                    val dao = BlofyDatabase.get(activity.applicationContext).dao()
                    val source = when (tab) {
                        LiveChannelTab.ALL -> if (query.isBlank()) base
                            else {
                                val fts = ArabicSearchNormalizer.ftsQuery(query)
                                val indexed = if (fts.isNotBlank()) runCatching {
                                    dao.searchStreamsFtsByKind(providerId, KIND_LIVE, fts, 200)
                                }.getOrDefault(emptyList()) else emptyList()
                                if (indexed.isNotEmpty()) indexed
                                else runCatching { dao.searchCatalog(providerId, KIND_LIVE, query, 200) }
                                    .getOrDefault(emptyList())
                            }
                        LiveChannelTab.FAVORITES ->
                            runCatching { dao.favorites(providerId).first() }
                                .getOrDefault(emptyList()).filter { it.kind == KIND_LIVE }
                        LiveChannelTab.RECENT ->
                            RecentChannelStore.keys(activity, providerId).take(30).mapNotNull {
                                key -> runCatching { dao.stream(key) }.getOrNull()
                                    ?.takeIf { it.kind == KIND_LIVE && it.providerId == providerId }
                            }
                    }
                    source.filter { LiveChannelPanelPolicy.matchesSearch(it.name, query) }
                        .distinctBy { it.key }.take(200)
                }
                if (dialog !== openDialog || openDialog.isShowing.not() ||
                    activity.isFinishing || activity.isDestroyed || activeTab != tab ||
                    searchText != query) return@launch
                adapter.replace(filtered)
                displayedChannels = filtered
                visibleCount?.text = if (filtered.isEmpty())
                    copy("ما فيه قنوات مطابقة", "No matching channels")
                    else copy("${filtered.size} قناة", "${filtered.size} channels")
                if (filtered.isNotEmpty() && !query.isBlank()) {
                    // Avoid stealing focus from the soft keyboard during typing.
                    listFocusAfterFilter(adapter, filtered)
                }
            }
        }

        private fun listFocusAfterFilter(adapter: LiveChannelAdapter, channels: List<StreamEntity>) {
            // The RecyclerView keeps the current focus during search; only its
            // adapter changes. This helper deliberately never jumps to another
            // view while the user is entering text.
            if (adapter.itemCount == 0 || channels.isEmpty()) return
        }

        /**
         * One continuous vertical sidebar: scrollable channels on top and
         * focusable remote-control buttons immediately below in the SAME view.
         * Nested track/quality dialogs remain the established player menus;
         * the video is never restarted or replaced.
         */
        /**
         * Flat LIVE controls. Voices are buttons inside this SAME ScrollView;
         * no folder picker, no nested dialogs and no player restart.
         */
        private fun buildAttachedActions(onChannels: () -> Unit): ScrollView {
            val scroller = ScrollView(activity).apply {
                isFillViewport = false
                isVerticalScrollBarEnabled = true
                overScrollMode = View.OVER_SCROLL_NEVER
                background = null
                descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
            }
            val footer = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = activity.resources.configuration.layoutDirection
                setPadding(dp(8), dp(3), dp(8), dp(4))
            }
            // The compact bottom bar is fixed, while channel rows above it
            // keep the remaining available height. Only expanding the audio
            // menu makes this single footer taller.
            fun resizeActions(requestedDp: Int) {
                scroller.post {
                    val params = scroller.layoutParams ?: return@post
                    val screenH = activity.resources.displayMetrics.heightPixels
                    val safePx = (screenH * 0.55f).toInt()
                    val heightPx = if (requestedDp <= 80) dp(requestedDp)
                        else minOf(dp(requestedDp), safePx)
                    if (params.height != heightPx) {
                        params.height = heightPx
                        scroller.layoutParams = params
                    }
                }
            }
            fun resetScroll() { scroller.post { scroller.scrollTo(0, 0) } }
            fun addHeading(caption: String) {
                footer.addView(TextView(activity).apply {
                    text = caption
                    textSize = 11.5f
                    setTextColor(BlofyTvDesign.TextSecondary)
                    typeface = BlofyTvDesign.HeadingTypeface
                    setPadding(dp(9), dp(3), dp(9), dp(2))
                }, LinearLayout.LayoutParams(-1, dp(22)))
            }
            fun button(label: String, onTap: () -> Unit): TextView {
                val result = TextView(activity).apply {
                    id = View.generateViewId()
                    text = label
                    contentDescription = label
                    textSize = 12.5f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTextColor(Color.WHITE)
                    typeface = BlofyTvDesign.HeadingTypeface
                    gravity = Gravity.CENTER
                    setPadding(dp(7), 0, dp(7), 0)
                    isFocusable = true
                    isClickable = true
                    fun shape(focused: Boolean) = GradientDrawable().apply {
                        cornerRadius = dp(10).toFloat()
                        setColor(if (focused) 0xFF60428D.toInt() else 0xEF272238.toInt())
                        setStroke(dp(if (focused) 2 else 1),
                            if (focused) 0xFFCFADFF.toInt() else 0xFF5E4787.toInt())
                    }
                    background = shape(false)
                    setOnFocusChangeListener { view, focused ->
                        view.background = shape(focused)
                        view.animate().cancel()
                        view.animate().alpha(if (focused) 1f else 0.92f)
                            .setDuration(90L).start()
                    }
                    setOnClickListener { onTap() }
                    setOnKeyListener { _, keyCode, event ->
                        if (event.action == KeyEvent.ACTION_DOWN &&
                            keyCode == KeyEvent.KEYCODE_DPAD_LEFT && !audioPickerOpen) {
                            onChannels()
                            true
                        } else false
                    }
                }
                footer.addView(result, LinearLayout.LayoutParams(-1, dp(38)).apply {
                    bottomMargin = dp(4)
                })
                return result
            }

            fun showActions(expanded: Boolean) {
                audioPickerOpen = false
                footer.removeAllViews()
                addHeading(copy("BLOFY • التحكم بالبث", "BLOFY • LIVE CONTROLS"))
                fun actionLabel(action: LiveChannelPanelAction): String = when (action) {
                    LiveChannelPanelAction.BLOFY_AUDIO -> copy("♫ المعلق", "♫ Commentary")
                    LiveChannelPanelAction.FAVORITE -> copy("☆ المفضلة", "☆ Favorite")
                    LiveChannelPanelAction.EPG -> copy("▣ الآن والقادم", "▣ Now and next")
                    LiveChannelPanelAction.MORE -> if (expanded)
                        copy("⌃ إخفاء الخيارات", "⌃ Close options")
                        else copy("⚙ المزيد", "⚙ More")
                    LiveChannelPanelAction.AUDIO_TRACKS ->
                        copy("◉ صوت القناة", "◉ Original audio tracks")
                    LiveChannelPanelAction.SUBTITLES -> copy("CC الترجمة", "CC Subtitles")
                    LiveChannelPanelAction.VIDEO_QUALITY -> copy("▣ الجودة", "▣ Quality")
                    LiveChannelPanelAction.STREAM_INFO ->
                        copy("ⓘ معلومات البث", "ⓘ Stream info")
                    LiveChannelPanelAction.RECONNECT -> copy("↻ إعادة الاتصال", "↻ Reconnect")
                }
                fun addAction(action: LiveChannelPanelAction): TextView = button(actionLabel(action)) {
                    when (action) {
                        LiveChannelPanelAction.BLOFY_AUDIO -> {
                            resizeActions(360)
                            showInlineArabicVoices(footer, scroller, ::button, ::addHeading) {
                                showActions(false)
                            }
                        }
                        LiveChannelPanelAction.MORE -> {
                            showActions(!expanded)
                            footer.post { (scroller.tag as? View)?.requestFocus() }
                        }
                        else -> {
                            close()
                            if (!activity.openLivePanelAction(action)) {
                                Toast.makeText(activity,
                                    copy("تعذر فتح هذا الخيار", "Unable to open control"),
                                    Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
                if (!expanded) {
                    // Two permanently reachable controls at the BOTTOM of the
                    // channel list; never scroll through channels to reach audio.
                    val audioControl = addAction(LiveChannelPanelAction.BLOFY_AUDIO)
                    val moreControl = addAction(LiveChannelPanelAction.MORE)
                    footer.removeView(audioControl)
                    footer.removeView(moreControl)
                    val bar = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        layoutDirection = View.LAYOUT_DIRECTION_LTR
                        gravity = Gravity.CENTER_VERTICAL
                        addView(audioControl, LinearLayout.LayoutParams(0, dp(42), 1f).apply {
                            marginEnd = dp(5)
                        })
                        addView(moreControl, LinearLayout.LayoutParams(0, dp(42), 1f))
                    }
                    footer.addView(bar, LinearLayout.LayoutParams(-1, dp(45)))
                    // LEFT from "more" goes to audio; LEFT from audio
                    // returns to the last highlighted channel row.
                    moreControl.setOnKeyListener { _, code, event ->
                        if (event.action == KeyEvent.ACTION_DOWN &&
                            code == KeyEvent.KEYCODE_DPAD_LEFT) {
                            audioControl.requestFocus()
                        } else false
                    }
                    audioControl.nextFocusRightId = moreControl.id
                    moreControl.nextFocusLeftId = audioControl.id
                    scroller.tag = audioControl
                    resizeActions(76)
                } else {
                    LiveChannelPanelPolicy.actions(BuildConfig.CODE_ONLY_LOGIN, true)
                        .forEach(::addAction)
                    scroller.tag = footer.getChildAt(1)
                    resizeActions(255)
                }
                resetScroll()
            }
            restoreMainActions = {
                showActions(false)
                footer.post {
                    if (dialog?.isShowing == true) (scroller.tag as? View)?.requestFocus()
                }
            }
            showActions(false)
            scroller.addView(footer, ViewGroup.LayoutParams(-1, -2))
            return scroller
        }

        /** One click starts a specific commentary track. Header labels are not
         * navigable folders; all source buttons live in one scrollable panel.
         */
        /**
         * BLOFY Premium Audio: one connected, scrollable LIVE sidebar.
         * All selectable stations are direct buttons; stars are independent
         * TV-remote-focusable shortcuts. "Recently worked" is local history,
         * NOT an assertion that an upstream source is online right now.
         */
        private fun showInlineArabicVoices(
            footer: LinearLayout,
            scroller: ScrollView,
            addButton: (String, () -> Unit) -> TextView,
            addHeading: (String) -> Unit,
            returnHome: () -> Unit
        ) {
            audioPickerOpen = true
            val allVoices = mutableListOf<StreamArabicAudioCatalog.Track>()
            var favoritesOnly = false
            var pendingButton: TextView? = null
            var pendingId: String? = null
            val baseColor = BlofyTvDesign.TextSecondary
            val status = TextView(activity).apply {
                textSize = 12f
                setTextColor(baseColor)
                maxLines = 3
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                setPadding(dp(12), dp(6), dp(12), dp(6))
                background = GradientDrawable().apply {
                    cornerRadius = dp(10).toFloat()
                    setColor(0x882C223D.toInt())
                    setStroke(dp(1), 0x556D508D)
                }
            }
            val sync = TextView(activity).apply {
                textSize = 11f
                setTextColor(baseColor)
                setPadding(dp(9), dp(3), dp(9), dp(4))
            }
            fun updateSync() {
                val value = activity.inlineArabicDelaySeconds()
                sync.text = copy("⏱ تأخير المعلق: +${value}ث  •  − تقديم / + تأخير تدريجي",
                    "⏱ Commentary delay: +${value}s  •  − advance / + gradually delay")
            }

            fun paintStatus(message: String, state: StreamAudioQuickPickPolicy.State?) {
                status.text = message
                status.setTextColor(when (state) {
                    StreamAudioQuickPickPolicy.State.PLAYING -> 0xFF9DE8B4.toInt()
                    StreamAudioQuickPickPolicy.State.FAILED_RECENTLY -> 0xFFFFB5A7.toInt()
                    else -> Color.WHITE
                })
            }

            fun render(
                focusId: String? = null, focusStar: Boolean = false,
                focusFirstVoice: Boolean = false
            ) {
                if (!audioPickerOpen || dialog?.isShowing != true) return
                val savedFavorites = StreamAudioQuickPickPrefs.favorites(activity)
                val lastGood = activity.lastConfirmedInlineArabicTrackId()
                val playing = activity.currentInlineArabicTrackId()
                val failed = allVoices.filter {
                    StreamAudioQuickPickPrefs.failedRecently(activity, it.id)
                }.mapTo(mutableSetOf()) { it.id }
                val choices = StreamAudioQuickPickPolicy.arrange(
                    allVoices, savedFavorites, lastGood, failed
                ) { it.id }
                val visible = if (favoritesOnly) choices.filter { it.id in savedFavorites }
                    else choices

                footer.removeAllViews()
                addHeading(copy("✦  BLOFY  •  الصوتيات المباشرة",
                    "✦  BLOFY  •  LIVE AUDIO"))
                addButton(copy("↩  العودة للتحكم", "↩  Back to live controls"), returnHome)
                addButton(copy("🔊  استعادة صوت القناة", "🔊  Use original channel audio")) {
                    pendingButton?.isEnabled = true
                    pendingButton = null
                    pendingId = null
                    activity.returnInlineOriginalAudio()
                    render(focusFirstVoice = true)
                    paintStatus(copy("صوت القناة الأصلي يعمل الآن.",
                        "Original channel audio is restored."), null)
                }
                footer.addView(status, LinearLayout.LayoutParams(-1, dp(48)).apply {
                    topMargin = dp(2); bottomMargin = dp(4)
                })
                // Keep synchronization ABOVE the station list, never after
                // dozens of tracks. The user can tune audio while watching.
                addHeading(copy("⏱ مزامنة الصوت مع الصورة", "⏱ SYNC COMMENTARY WITH VIDEO"))
                updateSync()
                footer.addView(sync, LinearLayout.LayoutParams(-1, dp(34)))
                val syncButtons = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = View.LAYOUT_DIRECTION_LTR
                    gravity = Gravity.CENTER_VERTICAL
                }
                fun addQuickSync(label: String, delta: Int) {
                    val item = addButton(label) {
                        if (activity.currentInlineArabicTrackId() == null) {
                            paintStatus(copy("شغّل صوتية أولًا لضبط التوقيت.",
                                "Select a playing voice before adjusting sync."), null)
                        } else {
                            val before = activity.inlineArabicDelaySeconds()
                            val after = activity.adjustInlineArabicSync(delta)
                            updateSync()
                            val message = when {
                                before == after -> copy(
                                    "وصلت لأقصى حد للتقديم أو التأخير (0–30 ثانية).",
                                    "Already at the 0–30 second limit.")
                                delta > 0 -> copy(
                                    "جارٍ تأخير صوت المعلق تدريجيًا للمزامنة مع الصورة.",
                                    "Gradually delaying commentary to match the picture.")
                                else -> copy(
                                    "جارٍ تقديم صوت المعلق للمزامنة مع الصورة.",
                                    "Advancing commentary to match the picture.")
                            }
                            paintStatus(message, null)
                        }
                    }
                    footer.removeView(item)
                    item.textSize = 11.5f
                    syncButtons.addView(item, LinearLayout.LayoutParams(0, dp(40), 1f).apply {
                        marginEnd = dp(3)
                    })
                }
                addQuickSync("−5ث", -5)
                addQuickSync("−1ث", -1)
                addQuickSync("+1ث", 1)
                addQuickSync("+5ث", 5)
                footer.addView(syncButtons, LinearLayout.LayoutParams(-1, dp(45)))
                addButton(copy("⟲ إعادة المزامنة إلى 0 ثانية",
                    "⟲ Reset audio offset to 0s")) {
                    activity.adjustInlineArabicSync(0)
                    updateSync()
                }
                val filterButton = addButton(
                    if (favoritesOnly) copy("☆  جميع المعلقين", "☆  Show all voices")
                    else copy("★  المفضلة فقط", "★  Favorites only")
                ) {
                    favoritesOnly = !favoritesOnly
                    render()
                }

                if (allVoices.isEmpty()) {
                    addHeading(copy("جارٍ جلب المعلقين من BLOFY…",
                        "Loading voices securely from BLOFY…"))
                    return
                }
                if (visible.isEmpty()) {
                    addHeading(copy("ما ثبتت معلقين. افتح الكل واضغط ☆ لحفظ المفضل.",
                        "No favorites yet. Show all, then press ☆ to pin a voice."))
                }

                var previousGroup = ""
                var focusTarget: TextView? = null
                var scrollTarget: View? = null
                visible.forEach { voice ->
                    val group = if (voice.id in savedFavorites)
                        copy("★  المعلقون المثبتون", "★  PINNED VOICES")
                    else if (voice.id == lastGood)
                        copy("◷  آخر صوتية اشتغلت", "◷  LAST WORKED")
                    else StreamArabicAudioCatalog.groupName(
                        voice, copy("ar", "en") == "en"
                    )
                    if (group != previousGroup) {
                        addHeading(group)
                        previousGroup = group
                    }
                    val condition = StreamAudioQuickPickPolicy.status(
                        voice.id, playing, lastGood, failed
                    )
                    val prefix = when (condition) {
                        StreamAudioQuickPickPolicy.State.PLAYING -> "● "
                        StreamAudioQuickPickPolicy.State.RECENTLY_WORKED -> "◷ "
                        StreamAudioQuickPickPolicy.State.FAILED_RECENTLY -> "⚠ "
                        StreamAudioQuickPickPolicy.State.UNTESTED -> "♫ "
                    }
                    val row = LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        layoutDirection = activity.resources.configuration.layoutDirection
                        gravity = Gravity.CENTER_VERTICAL
                    }
                    // Never capture an initializing Kotlin val from its own
                    // click callback (the compiler rejects that self-reference).
                    var playButtonRef: TextView? = null
                    val playButton = addButton(prefix + voice.label) {
                        // One click starts the chosen voice; no group/file pages.
                        pendingButton?.isEnabled = true
                        pendingButton = null
                        pendingId = voice.id
                        val attempt = copy("جارٍ تجربة ", "Connecting: ") + voice.label
                        paintStatus(attempt + copy(" • صوت القناة مستمر", " • original audio remains"), null)
                        val accepted = activity.playInlineArabicAudio(voice) { actuallyPlaying ->
                            if (actuallyPlaying) {
                                StreamAudioQuickPickPrefs.markStarted(activity, voice.id)
                            } else {
                                StreamAudioQuickPickPrefs.markFailed(activity, voice.id)
                            }
                            if (audioPickerOpen && dialog?.isShowing == true &&
                                pendingId == voice.id) {
                                pendingButton?.isEnabled = true
                                pendingButton = null
                                if (actuallyPlaying) {
                                    playButtonRef?.setTextColor(0xFF9DE8B4.toInt())
                                    playButtonRef?.text = "● " + voice.label
                                    paintStatus(copy("✓ يشتغل الآن: ", "✓ Playing now: ") +
                                        voice.label, StreamAudioQuickPickPolicy.State.PLAYING)
                                } else {
                                    playButtonRef?.setTextColor(0xFFFFB5A7.toInt())
                                    playButtonRef?.text = "⚠ " + voice.label
                                    paintStatus(copy("تعذر تشغيل ", "Failed: ") + voice.label +
                                        copy(" • رجع الصوت الأصلي. جرّب مصدرًا ثانيًا.",
                                            " • original audio restored. Choose another voice."),
                                        StreamAudioQuickPickPolicy.State.FAILED_RECENTLY)
                                }
                                updateSync()
                            }
                        }
                        if (accepted) {
                            pendingButton = playButtonRef
                            // Prevent accidental repeat clicks while buffering.
                            playButtonRef?.isEnabled = false
                        } else {
                            pendingId = null
                            StreamAudioQuickPickPrefs.markFailed(activity, voice.id)
                            paintStatus(copy("تعذر اختيار المعلق؛ الصوت الأصلي مستمر.",
                                "Voice unavailable; original channel audio continues."),
                                StreamAudioQuickPickPolicy.State.FAILED_RECENTLY)
                        }
                    }
                    playButtonRef = playButton
                    footer.removeView(playButton)
                    playButton.contentDescription = when (condition) {
                        StreamAudioQuickPickPolicy.State.PLAYING ->
                            copy("يشتغل الآن: ", "Playing now: ") + voice.label
                        StreamAudioQuickPickPolicy.State.RECENTLY_WORKED ->
                            copy("آخر مصدر نجح: ", "Previously worked: ") + voice.label
                        StreamAudioQuickPickPolicy.State.FAILED_RECENTLY ->
                            copy("تعذر مؤخرًا، اضغط للمحاولة: ", "Failed recently, press to retry: ") + voice.label
                        else -> voice.label
                    }
                    if (condition == StreamAudioQuickPickPolicy.State.PLAYING) {
                        playButton.setTextColor(0xFF9DE8B4.toInt())
                    } else if (condition == StreamAudioQuickPickPolicy.State.FAILED_RECENTLY) {
                        playButton.setTextColor(0xFFFFB5A7.toInt())
                    }
                    val starButton = addButton(if (voice.id in savedFavorites) "★" else "☆") {
                        val enabled = StreamAudioQuickPickPrefs.toggleFavorite(activity, voice.id)
                        // This is a personal shortcut, not an availability test.
                        val alreadyPinned = enabled
                        Toast.makeText(activity,
                            if (alreadyPinned) copy("تم تثبيت المعلق", "Voice pinned")
                            else copy("تم تحديث المفضلة", "Favorites updated"),
                            Toast.LENGTH_SHORT).show()
                        render(voice.id, focusStar = true)
                    }
                    footer.removeView(starButton)
                    starButton.gravity = Gravity.CENTER
                    starButton.textSize = 19f
                    starButton.contentDescription =
                        if (voice.id in savedFavorites)
                            copy("إزالة من المفضلة: ", "Unpin voice: ") + voice.label
                        else copy("تثبيت المعلق: ", "Pin voice: ") + voice.label
                    row.addView(playButton, LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                        marginEnd = dp(5)
                    })
                    row.addView(starButton, LinearLayout.LayoutParams(dp(43), dp(38)))
                    footer.addView(row, LinearLayout.LayoutParams(-1, dp(43)))
                    if (voice.id == focusId || (focusFirstVoice && focusTarget == null)) {
                        focusTarget = if (focusStar) starButton else playButton
                        scrollTarget = row
                    }
                }
                 if (focusTarget != null) {
                    val target = focusTarget
                    val row = scrollTarget
                    footer.post {
                        if (dialog?.isShowing == true && audioPickerOpen) {
                            target?.requestFocus()
                            scroller.smoothScrollTo(0, row?.top ?: 0)
                        }
                    }
                } else {
                    footer.post {
                        if (dialog?.isShowing == true && audioPickerOpen) {
                            filterButton.requestFocus()
                            scroller.scrollTo(0, 0)
                        }
                    }
                }
            }

            paintStatus(copy("♫ اختر معلقًا. ● تشغيل مؤكد، ◷ نجح سابقًا، ⚠ تعذر مؤخرًا.",
                "♫ Select a voice. ● playing, ◷ previously worked, ⚠ recently failed."), null)
            // Render controls immediately while the protected catalog loads.
            // A callback can never populate a picker that has already closed.
            render()
            activity.lifecycleScope.launch {
                val response = activity.inlineArabicAudioTracks()
                if (!audioPickerOpen || dialog?.isShowing != true ||
                    activity.isFinishing || activity.isDestroyed) return@launch
                if (response == null || response.tracks.isEmpty()) {
                    paintStatus(copy(
                        "تعذّر جلب الصوتيات الآن. صوت القناة الأصلي مستمر.",
                        "Voices unavailable right now. Original audio continues."
                    ), StreamAudioQuickPickPolicy.State.FAILED_RECENTLY)
                    return@launch
                }
                allVoices.clear()
                allVoices.addAll(response.tracks.distinctBy { it.id })
                paintStatus(copy(
                    "♫ اختر المعلق بضغطة؛ ☆ لتثبيته. ● تعني تشغيلًا مؤكدًا.",
                    "♫ One click plays. ☆ pins a voice. ● means confirmed playback."
                ), null)
                // Most important television UX: the first remote focus goes
                // directly to a playable voice, not to an empty sub-menu.
                render(focusFirstVoice = true)
            }
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
            if (activity.isFinishing || activity.isDestroyed) return
            val playingKey = RecentChannelStore.keys(activity, channel.providerId).firstOrNull()
                ?: currentChannelKey
            close()
            if (channel.key == playingKey) return
            if (!activity.selectLiveChannelFromPanel(channel)) {
                Toast.makeText(activity,
                    copy("تعذر فتح هذه القناة", "Unable to open this channel"),
                    Toast.LENGTH_SHORT).show()
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
