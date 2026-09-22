package tv.blofy.player.ui.browser

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.R
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

internal class LiveChannelAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit,
    private val onLongClick: (StreamEntity) -> Unit,
    private val itemKey: (StreamEntity) -> String,
    private val translucent: Boolean = false
) : RecyclerView.Adapter<LiveChannelAdapter.Holder>() {
    private val items = ArrayList<StreamEntity>(256)
    private var focusedKey: String? = null

    init { setHasStableIds(true) }

    fun submit(newItems: List<StreamEntity>) = replace(newItems)

    fun replace(newItems: List<StreamEntity>) {
        if (items.size == newItems.size && items.indices.all { items[it] == newItems[it] }) return
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    fun append(newItems: List<StreamEntity>) {
        if (newItems.isEmpty()) return
        val existingKeys = items.asSequence().map(itemKey).toHashSet()
        val unique = newItems.filter { existingKeys.add(itemKey(it)) }
        if (unique.isEmpty()) return
        val start = items.size
        items.addAll(unique)
        notifyItemRangeInserted(start, unique.size)
    }

    fun indexOfKey(key: String?): Int = if (key.isNullOrBlank()) -1 else items.indexOfFirst { itemKey(it) == key }
    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)
    override fun getItemId(position: Int) = itemKey(items[position]).hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        fun dp(v: Int) = TvUiTuning.dp(context, v)
        val compact = translucent
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(
                dp(if (compact) 8 else 12),
                dp(if (compact) 4 else 7),
                dp(if (compact) 9 else 14),
                dp(if (compact) 4 else 7)
            )
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = rowBackground(context, false)
        }
        row.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(if (compact) 56 else 68)).apply {
            bottomMargin = dp(if (compact) 4 else 6)
            marginStart = dp(3)
            marginEnd = dp(3)
        }
        val logo = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(if (compact) 4 else 5), dp(if (compact) 4 else 5), dp(if (compact) 4 else 5), dp(if (compact) 4 else 5))
            background = GradientDrawable().apply {
                cornerRadius = dp(if (compact) 9 else 10).toFloat()
                setColor(if (translucent) 0x54211332.toInt() else BlofyTvDesign.BackgroundRaised)
                setStroke(dp(1), if (translucent) 0x3FFFFFFF else BlofyTvDesign.Divider)
            }
        }
        val logoSize = dp(if (compact) 34 else 42)
        row.addView(logo, LinearLayout.LayoutParams(logoSize, logoSize).apply { marginStart = dp(if (compact) 6 else 8) })

        val textBox = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        val title = TextView(context).apply {
            textSize = TvUiTuning.sp(context, if (compact) 12.2f else 13.4f)
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = if (compact) 1 else 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.RIGHT
            includeFontPadding = false
            setLineSpacing(0f, 1.03f)
        }
        val meta = TextView(context).apply {
            textSize = TvUiTuning.sp(context, if (compact) 9.1f else 10.4f)
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.RIGHT
            includeFontPadding = false
        }
        val progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000
            progress = 0
            visibility = View.GONE
            progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.Divider)
        }
        textBox.addView(title, LinearLayout.LayoutParams(-1, 0, 1f))
        textBox.addView(meta, LinearLayout.LayoutParams(-1, dp(if (compact) 15 else 18)))
        textBox.addView(progress, LinearLayout.LayoutParams(-1, dp(3)).apply { topMargin = dp(2) })
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(if (compact) 44 else 54), 1f))

        val badge = TextView(context).apply {
            textSize = TvUiTuning.sp(context, if (compact) 7.6f else 8.4f)
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            background = BlofyTvDesign.badge(dp(if (compact) 8 else 9).toFloat())
        }
        row.addView(badge, LinearLayout.LayoutParams(dp(if (compact) 30 else 34), dp(if (compact) 20 else 23)).apply {
            marginStart = dp(if (compact) 5 else 8)
        })
        return Holder(row, logo, title, meta, badge, progress)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = (if (item.locked) "🔒  " else "") + item.name
        holder.meta.text = if (item.archiveEnabled) "مباشر • أرشيف متاح" else "مباشر الآن"
        holder.badge.text = if (item.archiveEnabled) "ARCH" else "LIVE"
        holder.progress.visibility = View.GONE
        holder.artworkCandidates = listOf(item.icon, item.backdrop).filterNot { it.isNullOrBlank() }
        if (holder.artworkCandidates.isNotEmpty()) ArtworkLoader.load(holder.logo, holder.artworkCandidates) else {
            ArtworkLoader.cancel(holder.logo)
            holder.logo.setImageResource(R.drawable.blofy_logo)
        }

        renderFocus(holder, holder.itemView.hasFocus())
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnLongClickListener { onLongClick(item); true }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            if (focused) focusedKey = itemKey(item)
            view.animate().cancel()
            renderFocus(holder, focused)
            val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (focused) TvUiTuning.focusElevation(view.context, TvUiTuning.dp(view.context, 7).toFloat()) else 0f)
                .setDuration(TvUiTuning.focusDuration(view.context, focused))
                .start()
            if (focused) onFocus(item)
        }
    }

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = rowBackground(holder.itemView.context, focused)
        holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextPrimary)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.Lavender else BlofyTvDesign.TextMuted)
        holder.badge.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.PurpleSoft)
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.logo)
        holder.artworkCandidates = emptyList()
        holder.logo.setImageDrawable(null)
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        holder.itemView.translationZ = 0f
        renderFocus(holder, false)
        super.onViewRecycled(holder)
    }

    override fun onViewDetachedFromWindow(holder: Holder) {
        ArtworkLoader.cancel(holder.logo)
        super.onViewDetachedFromWindow(holder)
    }

    override fun onViewAttachedToWindow(holder: Holder) {
        super.onViewAttachedToWindow(holder)
        if (holder.logo.tag == null && holder.artworkCandidates.isNotEmpty()) {
            ArtworkLoader.load(holder.logo, holder.artworkCandidates)
        }
    }

    override fun getItemCount() = items.size

    internal class Holder(
        item: View,
        val logo: ImageView,
        val title: TextView,
        val meta: TextView,
        val badge: TextView,
        val progress: ProgressBar
    ) : RecyclerView.ViewHolder(item) {
        var artworkCandidates: List<String?> = emptyList()
    }

    private fun rowBackground(contextForBackground: android.content.Context, focused: Boolean): GradientDrawable {
        if (!translucent) return CinemaStyle.surface(contextForBackground, focused = focused)
        val density = contextForBackground.resources.displayMetrics.density
        return GradientDrawable().apply {
            cornerRadius = 10 * density
            setColor(if (focused) 0xD35C3582.toInt() else 0x5E211332.toInt())
            setStroke(
                ((if (focused) 2 else 1) * density).toInt(),
                if (focused) BlofyTvDesign.FocusStroke else 0x38FFFFFF
            )
        }
    }
}
