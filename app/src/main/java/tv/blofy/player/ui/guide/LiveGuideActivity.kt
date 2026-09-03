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
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
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

/**
 * Fast local TV guide. Channel/category navigation reads the cached Room catalog only;
 * a short EPG refresh is requested only for the focused channel when needed.
 */
class LiveGuideActivity : AppCompatActivity() {
    private lateinit var provider: ProviderEntity
    private lateinit var categoryList: RecyclerView
    private lateinit var channelList: RecyclerView
    private lateinit var categoryAdapter: FocusTextAdapter<CategoryEntity>
    private lateinit var channelAdapter: GuideChannelAdapter
    private lateinit var guideTitle: TextView
    private lateinit var guideMeta: TextView
    private lateinit var nowTitle: TextView
    private lateinit var nowTime: TextView
    private lateinit var nowDescription: TextView
    private lateinit var nextTitle: TextView
    private lateinit var progress: ProgressBar
    private lateinit var countView: TextView

    private var selectedCategoryId: String? = null
    private var categoryRows: List<CategoryEntity> = emptyList()
    private var channelRows: List<StreamEntity> = emptyList()
    private var categoryJob: Job? = null
    private var guideJob: Job? = null
    private var epgRefreshJob: Job? = null
    private var selectedStream: StreamEntity? = null
    private val dao by lazy { BlofyDatabase.get(applicationContext).dao() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        bindAdapters()
        loadInitialData()
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(28), dp(20), dp(28), dp(24))
            background = AppCompatResources.getDrawable(this@LiveGuideActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        val headerCopy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            addView(TextView(this@LiveGuideActivity).apply {
                text = "BLOFY LIVE GUIDE"
                textSize = 11.5f
                letterSpacing = .13f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.RIGHT
            })
            addView(TextView(this@LiveGuideActivity).apply {
                text = "دليل القنوات"
                textSize = 29f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT
                includeFontPadding = false
            })
        }
        header.addView(headerCopy, LinearLayout.LayoutParams(0, dp(66), 1f))
        countView = TextView(this).apply {
            text = "جاري التحميل"
            textSize = 12.5f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            setPadding(dp(14), 0, dp(14), 0)
            background = badgeBackground()
        }
        header.addView(countView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38)))
        root.addView(header)

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_LTR
            clipChildren = false
            clipToPadding = false
        }

        categoryList = RecyclerView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            layoutManager = LinearLayoutManager(this@LiveGuideActivity)
            setPadding(dp(8), dp(10), dp(8), dp(10))
            background = panelBackground()
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(18)
            clipChildren = false
            clipToPadding = false
        }
        body.addView(categoryList, LinearLayout.LayoutParams(dp(245), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(18) })

        channelList = RecyclerView(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            layoutManager = LinearLayoutManager(this@LiveGuideActivity)
            setPadding(dp(8), dp(10), dp(8), dp(10))
            background = panelBackground()
            itemAnimator = null
            setHasFixedSize(true)
            setItemViewCacheSize(24)
            recycledViewPool.setMaxRecycledViews(0, 30)
            clipChildren = false
            clipToPadding = false
        }
        body.addView(channelList, LinearLayout.LayoutParams(dp(430), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(20) })

        body.addView(buildGuidePanel(), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(10) })
        return root
    }

    private fun buildGuidePanel(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        gravity = Gravity.TOP or Gravity.RIGHT
        setPadding(dp(24), dp(22), dp(24), dp(22))
        background = panelBackground()

        guideTitle = TextView(this@LiveGuideActivity).apply {
            text = "اختر قناة"
            textSize = 27f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 2
        }
        addView(guideTitle)

        guideMeta = TextView(this@LiveGuideActivity).apply {
            text = "الآن والتالي من دليل البرامج"
            textSize = 12.5f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, dp(18))
        }
        addView(guideMeta)

        addView(sectionLabel("الآن"))
        nowTitle = TextView(this@LiveGuideActivity).apply {
            text = "لا تتوفر معلومات البرنامج"
            textSize = 21f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 2
        }
        addView(nowTitle)

        nowTime = TextView(this@LiveGuideActivity).apply {
            textSize = 13f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.Mint)
            gravity = Gravity.RIGHT
            setPadding(0, dp(6), 0, dp(8))
        }
        addView(nowTime)

        progress = ProgressBar(this@LiveGuideActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000
            progress = 0
            progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
        }
        addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(7)).apply { bottomMargin = dp(14) })

        nowDescription = TextView(this@LiveGuideActivity).apply {
            textSize = 14f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            maxLines = 5
            setLineSpacing(0f, 1.14f)
        }
        addView(nowDescription)

        addView(sectionLabel("التالي").apply { setPadding(0, dp(24), 0, dp(8)) })
        nextTitle = TextView(this@LiveGuideActivity).apply {
            text = "لا تتوفر معلومات البرنامج التالي"
            textSize = 17f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.RIGHT
            maxLines = 2
        }
        addView(nextTitle)

        addView(TextView(this@LiveGuideActivity).apply {
            text = "OK تشغيل القناة   •   ← القنوات   •   ← مرة أخرى للفئات   •   BACK رجوع"
            textSize = 11.8f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { gravity = Gravity.BOTTOM })
    }

    private fun sectionLabel(value: String) = TextView(this).apply {
        text = value
        textSize = 11.5f
        letterSpacing = .08f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(BlofyTvDesign.PurpleBright)
        gravity = Gravity.RIGHT
        setPadding(0, 0, 0, dp(8))
    }

    private fun bindAdapters() {
        categoryAdapter = FocusTextAdapter(
            label = { it.name },
            onClick = { loadChannels(categoryId(it), immediate = true) },
            onFocus = { loadChannels(categoryId(it), immediate = false) },
            itemKey = { it.key }
        )
        channelAdapter = GuideChannelAdapter(
            onClick = ::guardedPlay,
            onFocus = ::showGuide
        )
        categoryList.adapter = categoryAdapter
        channelList.adapter = channelAdapter

        categoryList.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_RIGHT) return@setOnKeyListener false
            requestChannelFocus()
        }
        channelList.setOnKeyListener { _, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN || keyCode != KeyEvent.KEYCODE_DPAD_LEFT) return@setOnKeyListener false
            requestCategoryFocus()
        }
    }

    private fun loadInitialData() {
        lifecycleScope.launch {
            provider = dao.providers().first().firstOrNull() ?: run {
                Toast.makeText(this@LiveGuideActivity, "أضف قائمة تشغيل أولاً", Toast.LENGTH_SHORT).show()
                finish()
                return@launch
            }
            val categories = dao.categories(provider.id, KIND_LIVE).first()
            categoryRows = listOf(allCategory()) + categories
            categoryAdapter.submit(categoryRows)
            val requestedCategory = intent.getStringExtra(EXTRA_CATEGORY_ID)
                ?.takeIf { value -> categories.any { it.remoteId == value } }
            loadChannels(requestedCategory, immediate = true)
            categoryList.post { requestCategoryFocus() }
        }
    }

    private fun loadChannels(categoryId: String?, immediate: Boolean) {
        if (!::provider.isInitialized || selectedCategoryId == categoryId && channelRows.isNotEmpty()) return
        categoryJob?.cancel()
        categoryJob = lifecycleScope.launch {
            if (!immediate) delay(85L)
            selectedCategoryId = categoryId
            countView.text = "..."
            val items = dao.streams(provider.id, KIND_LIVE, categoryId).first()
            channelRows = items
            channelAdapter.submit(items)
            countView.text = "${items.size} قناة"
            selectedStream = null
            clearGuide()
            if (immediate) channelList.post { requestChannelFocus() }
        }
    }

    private fun showGuide(stream: StreamEntity) {
        selectedStream = stream
        guideTitle.text = stream.name
        guideMeta.text = buildString {
            append(if (stream.archiveEnabled) "يدعم الأرشيف" else "بث مباشر")
            stream.streamType?.takeIf(String::isNotBlank)?.let { append("  •  ").append(it.uppercase()) }
        }
        guideJob?.cancel()
        guideJob = lifecycleScope.launch {
            val now = System.currentTimeMillis()
            var epg = dao.epg(provider.id, stream.remoteId, now).first()
            if (epg.isEmpty() && !provider.providerType.equals("m3u", true)) {
                epgRefreshJob?.cancel()
                epgRefreshJob = lifecycleScope.launch {
                    runCatching { PlaylistManager(XtreamClient.api, dao).syncShortEpg(provider, stream.remoteId) }
                }
                epgRefreshJob?.join()
                if (selectedStream?.key != stream.key) return@launch
                epg = dao.epg(provider.id, stream.remoteId, now).first()
            }
            if (selectedStream?.key != stream.key) return@launch
            renderEpg(epg, now)
        }
    }

    private fun renderEpg(items: List<EpgEntity>, now: Long) {
        val current = items.firstOrNull { now in it.startMs until it.endMs } ?: items.firstOrNull()
        val next = current?.let { item -> items.firstOrNull { it.startMs >= item.endMs } }
        if (current == null) {
            nowTitle.text = "لا تتوفر معلومات البرنامج"
            nowTime.text = ""
            nowDescription.text = ""
            progress.progress = 0
        } else {
            nowTitle.text = current.title
            nowTime.text = "${time(current.startMs)} – ${time(current.endMs)}"
            nowDescription.text = current.description.orEmpty()
            val duration = (current.endMs - current.startMs).coerceAtLeast(1L)
            progress.progress = (((now - current.startMs).coerceIn(0L, duration) * 1000L) / duration).toInt()
        }
        nextTitle.text = if (next == null) {
            "لا تتوفر معلومات البرنامج التالي"
        } else {
            "${time(next.startMs)}   ${next.title}"
        }
    }

    private fun clearGuide() {
        guideTitle.text = "اختر قناة"
        guideMeta.text = "الآن والتالي من دليل البرامج"
        nowTitle.text = "لا تتوفر معلومات البرنامج"
        nowTime.text = ""
        nowDescription.text = ""
        nextTitle.text = "لا تتوفر معلومات البرنامج التالي"
        progress.progress = 0
    }

    private fun guardedPlay(stream: StreamEntity) {
        if (stream.locked) ParentalGate.requirePin(this) { play(stream) } else play(stream)
    }

    private fun play(stream: StreamEntity) {
        val profile = profile(provider)
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE)
            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, selectedCategoryId)
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
        })
    }

    private fun profile(value: ProviderEntity) = ProviderProfile(
        providerKey = value.id,
        liveFormat = if (value.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS,
        transport = if (value.preferredTransport.equals("http", true)) TransportPreference.HTTP_FIRST else TransportPreference.CRONET_FIRST,
        player = if (value.preferredEngine.equals("vlc", true)) PlayerPreference.VLC else PlayerPreference.MEDIA3,
        allowCrossProtocolRedirects = value.allowCrossProtocolRedirects,
        providerKind = ProviderKind.from(value.providerType)
    )

    private fun requestChannelFocus(): Boolean {
        if (channelAdapter.itemCount == 0) return false
        val requestedStreamId = intent.getStringExtra(EXTRA_STREAM_ID)
        val position = requestedStreamId?.let(channelAdapter::indexOfRemoteId)?.takeIf { it >= 0 } ?: 0
        channelList.scrollToPosition(position)
        channelList.post { channelList.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus() }
        return true
    }

    private fun requestCategoryFocus(): Boolean {
        if (categoryAdapter.itemCount == 0) return false
        val position = categoryRows.indexOfFirst { categoryId(it) == selectedCategoryId }.takeIf { it >= 0 } ?: 0
        categoryList.scrollToPosition(position)
        categoryList.post { categoryList.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus() }
        return true
    }

    private fun allCategory() = CategoryEntity(
        key = "${if (::provider.isInitialized) provider.id else "guide"}:live:$ALL_CATEGORY_ID",
        providerId = if (::provider.isInitialized) provider.id else "guide",
        remoteId = ALL_CATEGORY_ID,
        kind = KIND_LIVE,
        name = "كل القنوات",
        orderIndex = -1
    )

    private fun categoryId(category: CategoryEntity): String? = category.remoteId.takeUnless { it == ALL_CATEGORY_ID }
    private fun time(ms: Long) = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun panelBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xED21162D.toInt(), 0xF0130E1B.toInt())
    ).apply {
        cornerRadius = dp(20).toFloat()
        setStroke(dp(1), 0xFF4A355F.toInt())
    }

    private fun badgeBackground() = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(0x663A2350)
        setStroke(dp(1), 0xFF68488A.toInt())
    }

    override fun onDestroy() {
        categoryJob?.cancel()
        guideJob?.cancel()
        epgRefreshJob?.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_CATEGORY_ID = "category_id"
        const val EXTRA_STREAM_ID = "stream_id"
        private const val KIND_LIVE = "live"
        private const val ALL_CATEGORY_ID = "__all__"
    }
}

private class GuideChannelAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit
) : RecyclerView.Adapter<GuideChannelAdapter.Holder>() {
    private val items = ArrayList<StreamEntity>()

    init { setHasStableIds(true) }

    fun submit(values: List<StreamEntity>) {
        items.clear()
        items.addAll(values)
        notifyDataSetChanged()
    }

    fun indexOfRemoteId(remoteId: String): Int = items.indexOfFirst { it.remoteId == remoteId }
    override fun getItemId(position: Int): Long = items[position].key.hashCode().toLong()
    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        fun dp(v: Int) = (v * parent.resources.displayMetrics.density).toInt()
        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(12), dp(7))
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            background = rowBackground(false, dp(14))
        }
        val logo = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setImageResource(R.drawable.blofy_logo)
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(0xFF181020.toInt())
            }
        }
        root.addView(logo, LinearLayout.LayoutParams(dp(58), dp(58)).apply { marginStart = dp(12) })

        val copy = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        val title = TextView(parent.context).apply {
            textSize = 14f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val meta = TextView(parent.context).apply {
            textSize = 10.8f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        copy.addView(title)
        copy.addView(meta)
        root.addView(copy, LinearLayout.LayoutParams(0, dp(60), 1f))

        val number = TextView(parent.context).apply {
            textSize = 11.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(0x553B2452)
            }
        }
        root.addView(number, LinearLayout.LayoutParams(dp(52), dp(34)))
        return Holder(root, logo, title, meta, number)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = (if (item.locked) "🔒  " else "") + item.name
        holder.meta.text = buildString {
            append(if (item.archiveEnabled) "أرشيف" else "مباشر")
            item.streamType?.takeIf(String::isNotBlank)?.let { append("  •  ").append(it.uppercase()) }
        }
        holder.number.text = (position + 1).toString()
        ArtworkLoader.load(holder.logo, item.icon)
        holder.itemView.background = rowBackground(holder.itemView.hasFocus(), holder.dp(14))
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = rowBackground(focused, holder.dp(14))
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.012f else 1f)
                .scaleY(if (focused) 1.012f else 1f)
                .translationZ(if (focused) holder.dp(8).toFloat() else 1f)
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

    class Holder(
        itemView: View,
        val logo: ImageView,
        val title: TextView,
        val meta: TextView,
        val number: TextView
    ) : RecyclerView.ViewHolder(itemView) {
        fun dp(v: Int) = (v * itemView.resources.displayMetrics.density).toInt()
    }

    companion object {
        private fun rowBackground(focused: Boolean, radius: Int) = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            if (focused) intArrayOf(0xFF6A3CA0.toInt(), 0xFF352047.toInt())
            else intArrayOf(0xD923182F.toInt(), 0xE616101E.toInt())
        ).apply {
            cornerRadius = radius.toFloat()
            setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF49365D.toInt())
        }
    }
}
