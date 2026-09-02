package tv.blofy.player.ui.browser

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.R
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

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
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    fun append(newItems: List<StreamEntity>) {
        if (newItems.isEmpty()) return
        val start = items.size
        items.addAll(newItems)
        notifyItemRangeInserted(start, newItems.size)
    }

    fun indexOfKey(key: String?): Int {
        if (key.isNullOrBlank()) return -1
        return items.indexOfFirst { itemKey(it) == key }
    }

    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)

    override fun getItemId(position: Int) = itemKey(items[position]).hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val d = parent.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val row = LinearLayout(parent.context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(7), dp(12), dp(7))
            isFocusable = true; isClickable = true; isLongClickable = true
            background = rowBackground(false)
        }
        val logo = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat(); setColor(0xFF17111F.toInt()); setStroke(dp(1), 0xFF49375E.toInt())
            }
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(54), dp(54)).apply { marginStart = dp(12) })
        val textBox = LinearLayout(parent.context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        val title = TextView(parent.context).apply {
            textSize = 15f; typeface = Typeface.create("sans-serif", Typeface.BOLD); setTextColor(BlofyTvDesign.TextPrimary); maxLines = 1; gravity = Gravity.RIGHT
        }
        val meta = TextView(parent.context).apply {
            textSize = 11.5f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1; gravity = Gravity.RIGHT
        }
        textBox.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        textBox.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)))
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(58), 1f))
        val badge = TextView(parent.context).apply {
            textSize = 11f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.PurpleSoft); gravity = Gravity.CENTER
        }
        row.addView(badge, LinearLayout.LayoutParams(dp(48), dp(40)))
        return Holder(row, logo, title, meta, badge)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = (if (item.locked) "🔒 " else "") + item.name
        holder.meta.text = if (item.archiveEnabled) "أرشيف متاح" else "بث مباشر"
        holder.badge.text = if (item.archiveEnabled) "⏱" else "●"
        val art = item.icon ?: item.backdrop
        if (!art.isNullOrBlank()) ArtworkLoader.load(holder.logo, art) else {
            ArtworkLoader.cancel(holder.logo)
            holder.logo.setImageResource(R.drawable.blofy_logo)
        }
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnLongClickListener { onLongClick(item); true }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            if (focused) focusedKey = itemKey(item)
            view.background = rowBackground(focused)
            holder.title.setTextColor(Color.WHITE)
            holder.meta.setTextColor(if (focused) 0xFFE8D8FA.toInt() else BlofyTvDesign.TextMuted)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).translationZ(if (focused) 12f else 1f).setDuration(80).start()
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.logo)
        holder.logo.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    override fun getItemCount() = items.size

    internal class Holder(item: View, val logo: ImageView, val title: TextView, val meta: TextView, val badge: TextView) : RecyclerView.ViewHolder(item)

    private fun rowBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF713EC0.toInt(), 0xFF3A2358.toInt()) else intArrayOf(0xFF251A35.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = 18f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF433253.toInt())
    }
}
