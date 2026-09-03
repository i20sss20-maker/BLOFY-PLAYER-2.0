package tv.blofy.player.ui.guide

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.PlayerPreference
import tv.blofy.player.core.provider.ProviderKind
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.core.provider.TransportPreference
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.FocusTextAdapter
import tv.blofy.player.ui.player.PlayerActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class EpgGuideActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryList: RecyclerView
    private lateinit var channelList: RecyclerView
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var channelAdapter: GuideChannelAdapter
    private lateinit var statusView: TextView
    private lateinit var channelLogo: ImageView
    private lateinit var channelName: TextView
    private lateinit var currentProgram: TextView
    private lateinit var currentTime: TextView
    private lateinit var currentProgress: ProgressBar
    private lateinit var currentDescription: TextView
    private lateinit var nextProgram: TextView

    private val dao by lazy { BlofyDatabase.get(applicationContext).dao() }
    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }
    private val refreshAt = mutableMapOf<String, Long>()
    private var categories = emptyList<CategoryEntity>()
    private var currentCategoryId: String? = null
    private var selectedChannelKey: String? = null
    private var loadJob: Job? = null
    private var categoryFocusJob: Job? = null
    private var epgRefreshJob: Job? = null
    private var generation = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()

        lifecycleScope.launch {
            provider = dao.providers().first().firstOrNull() ?: run {
                finish()
                return@launch
            }
            dao.categories(provider.id, KIND_LIVE).collect { rows ->
                categories = listOf(allChannelsCategory(provider.id)) + rows
                categoryAdapter.submit(categories)
                if (currentCategoryId == null && channelAdapter.itemCount == 0) {
                    val saved = prefs.getString(categoryKey(provider.id), null)
                    val initial = saved?.takeIf { id ->
                        rows.any { it.remoteId == id }
                    }
                    loadCategory(initial, requestChannelFocus = false)
                }
                categoryList.post { requestCategoryFocus() }
            }
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(28), dp(20), dp(28), dp(24))
            background = AppCompatResources.getDrawable(
                this@EpgGuideActivity,
                R.drawable.blofy_home_background
            )
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        heading.addView(TextView(this).apply {
            text = "BLOFY LIVE GUIDE"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        heading.addView(TextView(this).apply {
            text = "دليل البرامج"
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            includeFontPadding = false
        })
        header.addView(heading, LinearLayout.LayoutParams(0, dp(68), 1f))
        statusView = TextView(this).apply {
            text = "جاري تجهيز الدليل..."
            textSize = 12.5f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            background = BlofyTvDesign.badge(dp(13).toFloat())
        }
        header.addView(statusView, LinearLayout.LayoutParams(-2, dp(38)))
        root.addView(header, LinearLayout.LayoutParams(-1, dp(72)))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        categoryList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpgGuideActivity)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(9), dp(11), dp(9), dp(11))
            background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setItemViewCacheSize(18)
        }
        body.addView(
            categoryList,
            LinearLayout.LayoutParams(dp(246), -1).apply { marginEnd = dp(18) }
        )

        channelList = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@EpgGuideActivity)
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(9), dp(11), dp(9), dp(11))
            background = BlofyTvDesign.elevatedSurface(dp(22).toFloat())
            clipChildren = false
            clipToPadding = false
            itemAnimator = null
            setItemViewCacheSize(20)
            recycledViewPool.setMaxRecycledViews(0, 26)
        }
        body.addView(
            channelList,
            LinearLayout.LayoutParams(dp(470), -1).apply { marginEnd = dp(18) }
        )
        body.addView(buildDetailsPanel(), LinearLayout.LayoutParams(0, -1, 1f))
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        channelAdapter = GuideChannelAdapter(
            onClick = ::guardedOpen,
            onFocus = { item ->
                selectedChannelKey = item.stream.key
                prefs.edit()
                    .putString(channelKey(), item.stream.key)
                    .apply()
                renderDetails(item)
                scheduleEpgRefresh(item.stream)
            }
        )
        channelList.adapter = channelAdapter

        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = {
                categoryFocusJob?.cancel()
                loadCategory(categoryId(it), requestChannelFocus = true)
            },
            onFocus = { category ->
                categoryFocusJob?.cancel()
                categoryFocusJob = lifecycleScope.launch {
                    delay(90L)
                    loadCategory(categoryId(category), requestChannelFocus = false)
                }
            },
            itemKey = { it.key }
        )
        categoryList.adapter = categoryAdapter
        installFocusBridge()
    }

    private fun buildDetailsPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.TOP or Gravity.RIGHT
        setPadding(dp(24), dp(22), dp(24), dp(22))
        background = BlofyTvDesign.elevatedSurface(dp(24).toFloat())
        elevation = dp(5).toFloat()

        val identity = LinearLayout(this@EpgGuideActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        channelLogo = ImageView(this@EpgGuideActivity).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setImageResource(R.drawable.blofy_logo)
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xFF17111F.toInt())
                setStroke(dp(1), 0xFF49345E.toInt())
            }
        }
        identity.addView(
            channelLogo,
            LinearLayout.LayoutParams(dp(94), dp(94)).apply { marginStart = dp(18) }
        )
        val identityCopy = LinearLayout(this@EpgGuideActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        identityCopy.addView(TextView(this@EpgGuideActivity).apply {
            text = "القناة المحددة"
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        channelName = TextView(this@EpgGuideActivity).apply {
            text = "اختر قناة من القائمة"
            textSize = 23f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        identityCopy.addView(channelName)
        identity.addView(identityCopy, LinearLayout.LayoutParams(0, dp(94), 1f))
        addView(identity)

        addView(sectionLabel("الآن", dp(20)))
        currentProgram = TextView(this@EpgGuideActivity).apply {
            text = "لا تتوفر معلومات البرنامج"
            textSize = 20f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        addView(currentProgram)
        currentTime = TextView(this@EpgGuideActivity).apply {
            text = "—"
            textSize = 12.5f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(5), 0, dp(7))
        }
        addView(currentTime)
        currentProgress = ProgressBar(
            this@EpgGuideActivity,
            null,
            android.R.attr.progressBarStyleHorizontal
        ).apply {
            max = 1000
            progress = 0
            progressTintList = android.content.res.ColorStateList.valueOf(
                BlofyTvDesign.PurpleBright
            )
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(
                0xFF35263F.toInt()
            )
        }
        addView(currentProgress, LinearLayout.LayoutParams(-1, dp(6)))
        currentDescription = TextView(this@EpgGuideActivity).apply {
            text = "قف على أي قناة لعرض البرنامج الحالي والتالي."
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            maxLines = 6
            setLineSpacing(0f, 1.15f)
            setPadding(0, dp(12), 0, dp(8))
        }
        addView(currentDescription)

        addView(sectionLabel("التالي", dp(12)))
        nextProgram = TextView(this@EpgGuideActivity).apply {
            text = "—"
            textSize = 16f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            background = GradientDrawable().apply {
                cornerRadius = dp(15).toFloat()
                setColor(0x66251A34)
                setStroke(dp(1), 0xFF49345E.toInt())
            }
            setPadding(dp(16), dp(12), dp(16), dp(12))
        }
        addView(nextProgram, LinearLayout.LayoutParams(-1, -2))

        addView(TextView(this@EpgGuideActivity).apply {
            text = "OK تشغيل القناة   •   ← الفئات   •   ↑↓ التنقل"
            textSize = 12f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, 0)
        })
    }

    private fun sectionLabel(label: String, top: Int) = TextView(this).apply {
        text = label
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(BlofyTvDesign.PurpleBright)
        gravity = Gravity.RIGHT
        setPadding(0, top, 0, dp(6))
    }

    private fun loadCategory(
        categoryId: String?,
        requestChannelFocus: Boolean
    ) {
        if (!::provider.isInitialized) return
        if (currentCategoryId == categoryId && channelAdapter.itemCount > 0) {
            if (requestChannelFocus) requestChannelFocus()
            return
        }

        currentCategoryId = categoryId
        prefs.edit().apply {
            if (categoryId == null) remove(categoryKey(provider.id))
            else putString(categoryKey(provider.id), categoryId)
        }.apply()
        generation += 1
        val requestGeneration = generation
        loadJob?.cancel()
        epgRefreshJob?.cancel()
        channelAdapter.submit(emptyList())
        statusView.text = "جاري قراءة الدليل المحلي..."

        loadJob = lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) {
                val channels = if (categoryId == null) {
                    dao.catalogPageAfterAll(provider.id, KIND_LIVE, 0L, GUIDE_CHANNEL_LIMIT)
                } else {
                    dao.catalogPageAfterInCategory(
                        provider.id,
                        KIND_LIVE,
                        categoryId,
                        0L,
                        GUIDE_CHANNEL_LIMIT
                    )
                }
                val now = System.currentTimeMillis()
                val result = ArrayList<GuideItem>(channels.size)
                for (stream in channels) {
                    val epg = dao.epg(provider.id, stream.remoteId, now, 4).first()
                    result += guideItem(stream, epg, now)
                }
                result
            }
            if (requestGeneration != generation || isFinishing) return@launch
            channelAdapter.submit(items)
            statusView.text = when {
                items.isEmpty() -> "لا توجد قنوات في هذه الفئة"
                items.size >= GUIDE_CHANNEL_LIMIT -> "${items.size}+ قناة • عرض سريع"
                else -> "${items.size} قناة • الآن والتالي"
            }
            if (items.isNotEmpty()) {
                val savedKey = prefs.getString(channelKey(), null)
                val index = items.indexOfFirst { it.stream.key == savedKey }
                    .takeIf { it >= 0 }
                    ?: 0
                channelList.scrollToPosition(index)
                channelList.post {
                    if (requestChannelFocus) {
                        channelList.findViewHolderForAdapterPosition(index)
                            ?.itemView
                            ?.requestFocus()
                    } else {
                        renderDetails(items[index])
                    }
                }
            } else {
                renderEmptyDetails()
            }
        }
    }

    private fun scheduleEpgRefresh(stream: StreamEntity) {
        if (!::provider.isInitialized || provider.providerType.equals("m3u", true)) return
        val now = System.currentTimeMillis()
        val last = refreshAt[stream.remoteId] ?: 0L
        if (now - last < EPG_REFRESH_COOLDOWN_MS) return

        epgRefreshJob?.cancel()
        epgRefreshJob = lifecycleScope.launch {
            delay(420L)
            if (selectedChannelKey != stream.key || isFinishing) return@launch
            refreshAt[stream.remoteId] = System.currentTimeMillis()
            runCatching {
                PlaylistManager(XtreamClient.api, dao)
                    .syncShortEpg(provider, stream.remoteId)
            }
            val refreshedAt = System.currentTimeMillis()
            val epg = dao.epg(provider.id, stream.remoteId, refreshedAt, 4).first()
            val item = guideItem(stream, epg, refreshedAt)
            channelAdapter.update(item)
            if (selectedChannelKey == stream.key) renderDetails(item)
        }
    }

    private fun guideItem(
        stream: StreamEntity,
        epg: List<EpgEntity>,
        now: Long
    ): GuideItem {
        val current = epg.firstOrNull { now in it.startMs until it.endMs }
            ?: epg.firstOrNull()
        val next = current?.let { currentItem ->
            epg.firstOrNull { it.startMs >= currentItem.endMs }
        } ?: epg.drop(1).firstOrNull()
        val progress = if (
            current != null &&
            current.endMs > current.startMs &&
            now in current.startMs..current.endMs
        ) {
            (((now - current.startMs) * 1000L) /
                (current.endMs - current.startMs))
                .toInt()
                .coerceIn(0, 1000)
        } else {
            0
        }
        return GuideItem(stream, current, next, progress)
    }

    private fun renderDetails(item: GuideItem) {
        channelName.text = item.stream.name
        ArtworkLoader.load(channelLogo, item.stream.icon)
        val current = item.current
        currentProgram.text = current?.title ?: "لا تتوفر معلومات البرنامج"
        currentTime.text = if (current == null) {
            "دليل البرنامج غير متوفر لهذه القناة"
        } else {
            "${time(current.startMs)} – ${time(current.endMs)}"
        }
        currentProgress.progress = item.progress
        currentDescription.text = current?.description
            ?.takeIf(String::isNotBlank)
            ?: "يعرض BLOFY بيانات الآن والتالي المحفوظة محليًا، ويحدّث القناة المحددة بهدوء عند الحاجة."
        nextProgram.text = item.next?.let {
            "${time(it.startMs)}   ${it.title}"
        } ?: "لا توجد معلومات للبرنامج التالي"
    }

    private fun renderEmptyDetails() {
        channelLogo.setImageResource(R.drawable.blofy_logo)
        channelName.text = "لا توجد قنوات"
        currentProgram.text = "اختر فئة أخرى"
        currentTime.text = "—"
        currentProgress.progress = 0
        currentDescription.text = "لم نجد قنوات محفوظة في هذه الفئة."
        nextProgram.text = "—"
    }

    private fun guardedOpen(item: GuideItem) {
        if (item.stream.locked) {
            ParentalGate.requirePin(this) { openStream(item.stream) }
        } else {
            openStream(item.stream)
        }
    }

    private fun openStream(stream: StreamEntity) {
        val profile = providerProfile(provider)
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE)
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(
                PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS,
                provider.allowCrossProtocolRedirects
            )
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, currentCategoryId)
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
        })
    }

    private fun installFocusBridge() {
        categoryList.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                requestChannelFocus()
            } else {
                false
            }
        }
        channelList.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                requestCategoryFocus()
            } else {
                false
            }
        }
    }

    private fun requestChannelFocus(): Boolean {
        if (channelAdapter.itemCount == 0) return false
        val index = channelAdapter.indexOfKey(selectedChannelKey)
            .takeIf { it >= 0 }
            ?: 0
        channelList.scrollToPosition(index)
        channelList.post {
            channelList.findViewHolderForAdapterPosition(index)
                ?.itemView
                ?.requestFocus()
        }
        return true
    }

    private fun requestCategoryFocus(): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val index = categories.indexOfFirst {
            categoryId(it) == currentCategoryId
        }.takeIf { it >= 0 } ?: 0
        categoryList.scrollToPosition(index)
        categoryList.post {
            categoryList.findViewHolderForAdapterPosition(index)
                ?.itemView
                ?.requestFocus()
        }
        return true
    }

    private fun providerProfile(provider: ProviderEntity) = ProviderProfile(
        providerKey = provider.id,
        liveFormat = if (provider.liveFormat.equals("m3u8", true)) {
            LiveFormat.HLS
        } else {
            LiveFormat.TS
        },
        transport = if (provider.preferredTransport.equals("http", true)) {
            TransportPreference.HTTP_FIRST
        } else {
            TransportPreference.CRONET_FIRST
        },
        player = if (provider.preferredEngine.equals("vlc", true)) {
            PlayerPreference.VLC
        } else {
            PlayerPreference.MEDIA3
        },
        allowCrossProtocolRedirects = provider.allowCrossProtocolRedirects,
        providerKind = ProviderKind.from(provider.providerType)
    )

    private fun allChannelsCategory(providerId: String) = CategoryEntity(
        key = "$providerId:$KIND_LIVE:$ALL_CATEGORY_ID",
        providerId = providerId,
        remoteId = ALL_CATEGORY_ID,
        kind = KIND_LIVE,
        name = "كل القنوات",
        orderIndex = -1
    )

    private fun categoryId(category: CategoryEntity): String? =
        category.remoteId.takeUnless { it == ALL_CATEGORY_ID }

    private fun categoryKey(providerId: String) = "$providerId:last_guide_category"
    private fun channelKey() = "${provider.id}:${currentCategoryId ?: ALL_CATEGORY_ID}:last_guide_channel"
    private fun time(value: Long): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(value))
    private fun dp(value: Int) =
        (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        generation += 1
        loadJob?.cancel()
        categoryFocusJob?.cancel()
        epgRefreshJob?.cancel()
        super.onDestroy()
    }

    private data class GuideItem(
        val stream: StreamEntity,
        val current: EpgEntity?,
        val next: EpgEntity?,
        val progress: Int
    )

    private class GuideChannelAdapter(
        private val onClick: (GuideItem) -> Unit,
        private val onFocus: (GuideItem) -> Unit
    ) : RecyclerView.Adapter<GuideChannelAdapter.Holder>() {
        private val items = ArrayList<GuideItem>()

        init {
            setHasStableIds(true)
        }

        fun submit(rows: List<GuideItem>) {
            items.clear()
            items.addAll(rows)
            notifyDataSetChanged()
        }

        fun update(item: GuideItem) {
            val index = items.indexOfFirst { it.stream.key == item.stream.key }
            if (index < 0) return
            items[index] = item
            notifyItemChanged(index)
        }

        fun indexOfKey(key: String?): Int {
            if (key.isNullOrBlank()) return -1
            return items.indexOfFirst { it.stream.key == key }
        }

        override fun getItemId(position: Int): Long =
            items[position].stream.key.hashCode().toLong()

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val context = parent.context
            val density = context.resources.displayMetrics.density
            fun dp(value: Int) = (value * density).toInt()

            val root = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(7), dp(12), dp(7))
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                background = rowBackground(false, dp(15))
            }
            val logo = ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setImageResource(R.drawable.blofy_logo)
                background = GradientDrawable().apply {
                    cornerRadius = dp(12).toFloat()
                    setColor(0xFF17111F.toInt())
                }
            }
            root.addView(
                logo,
                LinearLayout.LayoutParams(dp(62), dp(62)).apply {
                    marginStart = dp(12)
                }
            )
            val copy = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            }
            val name = TextView(context).apply {
                textSize = 14f
                typeface = BlofyTvDesign.LabelTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val program = TextView(context).apply {
                textSize = 11.7f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.RIGHT
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(0, dp(3), 0, dp(3))
            }
            val progress = ProgressBar(
                context,
                null,
                android.R.attr.progressBarStyleHorizontal
            ).apply {
                max = 1000
                progressTintList = android.content.res.ColorStateList.valueOf(
                    BlofyTvDesign.PurpleBright
                )
                progressBackgroundTintList = android.content.res.ColorStateList.valueOf(
                    0xFF35263F.toInt()
                )
            }
            copy.addView(name)
            copy.addView(program)
            copy.addView(progress, LinearLayout.LayoutParams(-1, dp(4)))
            root.addView(copy, LinearLayout.LayoutParams(0, dp(62), 1f))
            root.layoutParams = RecyclerView.LayoutParams(-1, dp(82)).apply {
                bottomMargin = dp(7)
            }
            return Holder(root, logo, name, program, progress)
        }

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val item = items[position]
            holder.itemView.tag = item.stream.key
            holder.name.text = item.stream.name
            holder.program.text = item.current?.let {
                "الآن  •  ${it.title}"
            } ?: "لا تتوفر معلومات البرنامج"
            holder.progress.progress = item.progress
            ArtworkLoader.load(holder.logo, item.stream.icon)
            renderFocus(holder.itemView, holder.name, holder.program, holder.itemView.hasFocus())
            holder.itemView.setOnClickListener { onClick(item) }
            holder.itemView.setOnFocusChangeListener { view, focused ->
                renderFocus(view, holder.name, holder.program, focused)
                view.animate().cancel()
                view.animate()
                    .scaleX(if (focused) 1.012f else 1f)
                    .scaleY(if (focused) 1.012f else 1f)
                    .translationZ(if (focused) dp(view, 9).toFloat() else 1f)
                    .setDuration(60L)
                    .start()
                if (focused) onFocus(item)
            }
        }

        override fun onViewRecycled(holder: Holder) {
            ArtworkLoader.cancel(holder.logo)
            holder.logo.setImageResource(R.drawable.blofy_logo)
            super.onViewRecycled(holder)
        }

        override fun getItemCount(): Int = items.size

        private fun renderFocus(
            view: View,
            name: TextView,
            program: TextView,
            focused: Boolean
        ) {
            view.background = rowBackground(focused, dp(view, 15))
            name.setTextColor(Color.WHITE)
            program.setTextColor(
                if (focused) 0xFFEBDFFF.toInt() else BlofyTvDesign.TextMuted
            )
        }

        private fun dp(view: View, value: Int) =
            (value * view.resources.displayMetrics.density).toInt()

        private fun rowBackground(focused: Boolean, radius: Int) = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            if (focused) {
                intArrayOf(0xFF65379A.toInt(), 0xFF342047.toInt())
            } else {
                intArrayOf(0xE620172D.toInt(), 0xE614101C.toInt())
            }
        ).apply {
            cornerRadius = radius.toFloat()
            setStroke(
                if (focused) 2 else 1,
                if (focused) BlofyTvDesign.PurpleBright else 0xFF3D304B.toInt()
            )
        }

        class Holder(
            itemView: View,
            val logo: ImageView,
            val name: TextView,
            val program: TextView,
            val progress: ProgressBar
        ) : RecyclerView.ViewHolder(itemView)
    }

    companion object {
        private const val PREFS = "blofy_epg_guide_state"
        private const val KIND_LIVE = "live"
        private const val ALL_CATEGORY_ID = "__all__"
        private const val GUIDE_CHANNEL_LIMIT = 240
        private const val EPG_REFRESH_COOLDOWN_MS = 2L * 60L * 1000L
    }
}
