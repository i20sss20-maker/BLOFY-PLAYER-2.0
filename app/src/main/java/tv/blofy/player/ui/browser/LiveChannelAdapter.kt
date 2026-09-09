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
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

internal class LiveChannelAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit,
    private val onLongClick: (StreamEntity) -> Unit,
    private val itemKey: (StreamEntity) -> String
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
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(7), dp(14), dp(7))
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = rowBackground(false)
        }
        row.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(82)).apply {
            bottomMargin = dp(8)
            marginStart = dp(3)
            marginEnd = dp(3)
        }
        val logo = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(BlofyTvDesign.BackgroundRaised)
                setStroke(dp(1), BlofyTvDesign.Divider)
            }
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(52), dp(52)).apply { marginStart = dp(12) })

        val textBox = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        val title = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 13.4f)
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.RIGHT
            includeFontPadding = false
            setLineSpacing(0f, 1.03f)
        }
        val meta = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 10.4f)
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
        textBox.addView(meta, LinearLayout.LayoutParams(-1, dp(18)))
        textBox.addView(progress, LinearLayout.LayoutParams(-1, dp(3)).apply { topMargin = dp(2) })
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(63), 1f))

        val badge = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 8.4f)
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.CENTER
            background = BlofyTvDesign.badge(dp(9).toFloat())
        }
        row.addView(badge, LinearLayout.LayoutParams(dp(44), dp(25)).apply { marginStart = dp(10) })
        return Holder(row, logo, title, meta, badge, progress)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = (if (item.locked) "🔒  " else "") + item.name
        holder.meta.text = if (item.archiveEnabled) "مباشر • أرشيف متاح" else "مباشر الآن"
        holder.badge.text = if (item.archiveEnabled) "ARCH" else "LIVE"
        holder.progress.visibility = View.GONE
        val art = item.icon ?: item.backdrop
        if (!art.isNullOrBlank()) ArtworkLoader.load(holder.logo, art) else {
            ArtworkLoader.cancel(holder.logo)
            holder.logo.setImageResource(R.drawable.blofy_logo)
        }

        renderFocus(holder, holder.itemView.hasFocus())
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnLongClickListener { onLongClick(item); true }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            if (focused) focusedKey = itemKey(item)
            view.animate().cancel()
            view.scaleX = 1f
            view.scaleY = 1f
            view.translationZ = if (focused) 4f else 0f
            renderFocus(holder, focused)
            if (focused) onFocus(item)
        }
    }

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = rowBackground(focused)
        holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextPrimary)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.Lavender else BlofyTvDesign.TextMuted)
        holder.badge.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.PurpleSoft)
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.logo)
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

    override fun getItemCount() = items.size

    internal class Holder(
        item: View,
        val logo: ImageView,
        val title: TextView,
        val meta: TextView,
        val badge: TextView,
        val progress: ProgressBar
    ) : RecyclerView.ViewHolder(item)

    private fun rowBackground(focused: Boolean) = BlofyTvDesign.glassSurface(16f, focused)
}
