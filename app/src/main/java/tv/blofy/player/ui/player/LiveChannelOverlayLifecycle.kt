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
            val adapter = LiveChannelAdapter(
                onClick = { channel -> selectChannel(channel) },
                onFocus = {},
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
                translucent = true
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
                    setColor(0x8A1A1527.toInt())
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
                                setColor(if (tab == activeTab) 0xB25A3384.toInt() else 0x522C2538)
                            }
                            setOnClickListener {
                                activeTab = tab
                                for (index in 0 until tabContainer.childCount) {
                                    tabContainer.getChildAt(index)?.background = GradientDrawable().apply {
                                        cornerRadius = dp(10).toFloat()
                                        setColor(if (index == options.indexOfFirst { it.first == tab })
                                            0xB25A3384.toInt() else 0x522C2538)
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
                    setColor(0x7416121E.toInt())
                    setStroke(dp(1), 0x4D7956A8.toInt())
                }
                elevation = dp(7).toFloat()
                addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
                addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)))
                if (BuildConfig.CODE_ONLY_LOGIN) {
                    searchField?.let { addView(it, LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(46)).apply {
                            marginStart = dp(7); marginEnd = dp(7); bottomMargin = dp(5)
                        }) }
                    addView(tabs, LinearLayout.LayoutParams(-1, dp(40)))
                    addView(count, LinearLayout.LayoutParams(-1, dp(19)))
                }
                // Channel rows scroll above the controls. Both are in this one
                // translucent panel, not in separate floating HUD windows.
                addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
                if (BuildConfig.CODE_ONLY_LOGIN) {
                    // Reserve a fixed, scrollable remote-control footer so 38
                    // direct audio buttons never shrink the channel list.
                    addView(buildAttachedActions(), LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, dp(170)))
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
            created.setOnKeyListener { _, keyCode, event ->
                if (keyCode == KeyEvent.KEYCODE_BACK &&
                    event.action == KeyEvent.ACTION_DOWN && audioPickerOpen) {
                    restoreMainActions?.invoke()
                    true
                } else false
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
        private fun buildAttachedActions(): ScrollView {
            val scroller = ScrollView(activity).apply {
                isFillViewport = false
                isVerticalScrollBarEnabled = true
                overScrollMode = View.OVER_SCROLL_NEVER
                background = null
            }
            val footer = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                layoutDirection = activity.resources.configuration.layoutDirection
                setPadding(dp(8), dp(3), dp(8), dp(6))
            }
            fun resetScroll() { scroller.post { scroller.scrollTo(0, 0) } }
            fun addHeading(caption: String) {
                footer.addView(TextView(activity).apply {
                    text = caption
                    textSize = 12f
                    setTextColor(BlofyTvDesign.TextSecondary)
                    typeface = BlofyTvDesign.HeadingTypeface
                    setPadding(dp(9), dp(6), dp(9), dp(5))
                }, LinearLayout.LayoutParams(-1, dp(29)))
            }
            fun button(label: String, onTap: () -> Unit): TextView {
                val result = TextView(activity).apply {
                    text = label
                    contentDescription = label
                    textSize = 12.5f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTextColor(Color.WHITE)
                    typeface = BlofyTvDesign.HeadingTypeface
                    gravity = Gravity.CENTER_VERTICAL or Gravity.START
                    setPadding(dp(11), 0, dp(11), 0)
                    isFocusable = true
                    isClickable = true
                    fun shape(focused: Boolean) = GradientDrawable().apply {
                        cornerRadius = dp(10).toFloat()
                        setColor(if (focused) 0xDE60428D.toInt() else 0x76272238)
                        setStroke(dp(1), if (focused) 0xFFCFADFF.toInt() else 0x665E4787)
                    }
                    background = shape(false)
                    setOnFocusChangeListener { view, focused -> view.background = shape(focused) }
                    setOnClickListener { onTap() }
                }
                footer.addView(result, LinearLayout.LayoutParams(-1, dp(38)).apply {
                    bottomMargin = dp(4)
                })
                return result
            }

            fun showActions(expanded: Boolean) {
                audioPickerOpen = false
                footer.removeAllViews()
                addHeading(copy("التحكم بالبث", "LIVE CONTROLS"))
                for (action in LiveChannelPanelPolicy.actions(BuildConfig.CODE_ONLY_LOGIN, expanded)) {
                    val label = when (action) {
                        LiveChannelPanelAction.BLOFY_AUDIO ->
                            copy("♫  اختر التعليق العربي", "♫  Choose Arabic voice")
                        LiveChannelPanelAction.FAVORITE ->
                            copy("☆  المفضلة", "☆  Toggle favorite")
                        LiveChannelPanelAction.EPG ->
                            copy("▣  الآن والقادم", "▣  Now and next")
                        LiveChannelPanelAction.MORE ->
                            if (expanded) copy("⌃  إخفاء", "⌃  Fewer controls")
                            else copy("⌄  خيارات إضافية", "⌄  More controls")
                        LiveChannelPanelAction.AUDIO_TRACKS ->
                            copy("◉  صوت القناة", "◉  Original audio tracks")
                        LiveChannelPanelAction.SUBTITLES ->
                            copy("CC  الترجمة", "CC  Subtitles")
                        LiveChannelPanelAction.VIDEO_QUALITY ->
                            copy("▣  الجودة", "▣  Video quality")
                        LiveChannelPanelAction.STREAM_INFO ->
                            copy("ⓘ  معلومات البث", "ⓘ  Stream information")
                        LiveChannelPanelAction.RECONNECT ->
                            copy("↻  إعادة الاتصال", "↻  Reconnect")
                    }
                    button(label) {
                        when (action) {
                            LiveChannelPanelAction.BLOFY_AUDIO -> showInlineArabicVoices(
                                footer, scroller, ::button, ::addHeading) { showActions(false) }
                            LiveChannelPanelAction.MORE -> {
                                showActions(!expanded)
                                footer.post { footer.getChildAt(1)?.requestFocus() }
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
                }
                resetScroll()
            }
            restoreMainActions = {
                showActions(false)
                footer.post { if (dialog?.isShowing == true) footer.getChildAt(1)?.requestFocus() }
            }
            showActions(false)
            scroller.addView(footer, ViewGroup.LayoutParams(-1, -2))
            return scroller
        }

        /** One click starts a specific commentary track. Header labels are not
         * navigable folders; all source buttons live in one scrollable panel.
         */
        private fun showInlineArabicVoices(
            footer: LinearLayout,
            scroller: ScrollView,
            addButton: (String, () -> Unit) -> TextView,
            addHeading: (String) -> Unit,
            returnHome: () -> Unit
        ) {
            audioPickerOpen = true
            footer.removeAllViews()
            addHeading(copy("🎙 اختر المعلق مباشرة", "🎙 One-tap Arabic voices"))
            val back = addButton(copy("↩ رجوع للتحكم", "↩ Back to controls"), returnHome)
            addButton(copy("🔊 صوت القناة الأصلي", "🔊 Original channel audio")) {
                activity.returnInlineOriginalAudio()
                Toast.makeText(activity,
                    copy("رجع صوت القناة الأصلي", "Original channel audio restored"),
                    Toast.LENGTH_SHORT).show()
            }

            // These are direct remote buttons, not modal synchronization pages.
            val sync = TextView(activity).apply {
                textSize = 11.5f
                setTextColor(BlofyTvDesign.TextSecondary)
                setPadding(dp(9), dp(3), dp(9), dp(4))
            }
            fun refreshSync() {
                sync.text = copy("التأخير: ", "Delay: ") +
                    activity.inlineArabicDelaySeconds() + copy(" ثانية", "s")
            }
            refreshSync()
            footer.addView(sync, LinearLayout.LayoutParams(-1, dp(24)))
            addButton(copy("−1ث  تقديم الصوت", "−1s  Advance audio")) {
                activity.adjustInlineArabicSync(-1); refreshSync()
            }
            addButton(copy("+1ث  تأخير الصوت", "+1s  Delay audio")) {
                activity.adjustInlineArabicSync(1); refreshSync()
            }
            addButton(copy("⟲  تصفير التأخير", "⟲  Reset delay")) {
                activity.adjustInlineArabicSync(0); refreshSync()
            }

            val status = TextView(activity).apply {
                text = copy("جارٍ تحميل المعلقين…", "Loading available voices…")
                textSize = 11f
                setTextColor(BlofyTvDesign.TextSecondary)
                setPadding(dp(9), dp(5), dp(9), dp(5))
                maxLines = 3
            }
            footer.addView(status, LinearLayout.LayoutParams(-1, -2))
            back.post { if (dialog?.isShowing == true) back.requestFocus() }
            scroller.post { scroller.scrollTo(0, 0) }
            activity.lifecycleScope.launch {
                val response = activity.inlineArabicAudioTracks()
                if (!audioPickerOpen || dialog?.isShowing != true ||
                    activity.isFinishing || activity.isDestroyed) return@launch
                if (response == null || response.tracks.isEmpty()) {
                    status.text = copy(
                        "ما توفرت صوتيات للقناة حاليًا؛ صوتها الأصلي مستمر.",
                        "No available voices right now; original audio continues.")
                    return@launch
                }
                status.text = copy(
                    "اضغط على أي معلق لتشغيله مباشرة. يبقى صوت القناة حتى يشتغل.",
                    "Press a voice once to play. Original audio stays until it starts.")
                val voices = response.tracks.distinctBy { it.id }
                var lastGroup = ""
                voices.forEach { voice ->
                    val group = StreamArabicAudioCatalog.groupName(
                        voice, copy("ar", "en") == "en")
                    if (group != lastGroup) {
                        addHeading(group)
                        lastGroup = group
                    }
                    val selected = activity.currentInlineArabicTrackId() == voice.id
                    val label = (if (selected) "✓ " else "♫ ") + voice.label
                    addButton(label) {
                        status.text = copy(
                            "جارٍ الاتصال بـ ${voice.label}… الصوت الأصلي مستمر.",
                            "Connecting to ${voice.label}… original audio continues.")
                        val accepted = activity.playInlineArabicAudio(voice) { playing ->
                            if (dialog?.isShowing == true && audioPickerOpen) {
                                status.text = if (playing)
                                    copy("✓ يشتغل الآن: ${voice.label}", "✓ Playing: ${voice.label}")
                                else copy("فشل تشغيل ${voice.label}؛ رجع الصوت الأصلي.",
                                    "Voice unavailable: ${voice.label}. Original audio restored.")
                                refreshSync()
                            }
                        }
                        if (!accepted) {
                            status.text = copy("تعذّر اختيار المعلق", "Could not select voice")
                        }
                    }
                }
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
