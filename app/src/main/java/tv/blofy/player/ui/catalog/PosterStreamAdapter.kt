package tv.blofy.player.ui.catalog

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign

internal class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit = {}
) : RecyclerView.Adapter<PosterStreamAdapter.Holder>() {
    private val items = ArrayList<StreamEntity>(256)

    init { setHasStableIds(true) }

    fun replace(newItems: List<StreamEntity>) { items.clear(); items.addAll(newItems); notifyDataSetChanged() }
    fun append(newItems: List<StreamEntity>) { if (newItems.isEmpty()) return; val start = items.size; items.addAll(newItems); notifyItemRangeInserted(start, newItems.size) }
    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)
    override fun getItemId(position: Int): Long = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            setPadding(dp(4), dp(4), dp(4), dp(5))
            background = card(false)
            clipToOutline = true
            elevation = 0f
        }
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.rgb(20, 15, 31))
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(176)))
        val rating = TextView(parent.context).apply {
            textSize = 9.4f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(2), dp(6), dp(2))
            visibility = View.GONE
            background = GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(0xE85A2A82.toInt())
                setStroke(dp(1), BlofyTvDesign.PurpleBright)
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { topMargin = dp(6); marginEnd = dp(6) })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(176)))
        val title = TextView(parent.context).apply {
            textSize = 11.2f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(3), dp(5), dp(3), 0)
            includeFontPadding = false
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(34)))
        val meta = TextView(parent.context).apply {
            textSize = 9.4f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(3), 0, dp(3), 0)
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(17)))
        return Holder(root, image, title, meta, rating)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.itemView.tag = item.key
        holder.title.text = item.name
        holder.meta.text = listOfNotNull(
            item.year?.takeIf(String::isNotBlank),
            item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')
        ).joinToString("  •  ")
        holder.rating.text = item.rating?.takeIf(String::isNotBlank)?.let { "★ $it" }.orEmpty()
        holder.rating.visibility = if (holder.rating.text.isNotBlank()) View.VISIBLE else View.GONE
        renderFocus(holder, holder.itemView.hasFocus())
        ArtworkLoader.load(holder.image, item.icon ?: item.backdrop)
        if (position % 8 == 0) {
            val next = (position + 1 until minOf(items.size, position + 11)).map { index -> items[index].icon ?: items[index].backdrop }
            ArtworkLoader.prefetch(holder.itemView.context, next)
        }
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.animate().cancel()
            view.scaleX = 1f
            view.scaleY = 1f
            view.translationZ = if (focused) 3f else 0f
            renderFocus(holder, focused)
            if (focused) onFocus(item)
        }
    }

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = card(focused)
        holder.title.typeface = if (focused) BlofyTvDesign.LabelTypeface else BlofyTvDesign.MediumTypeface
        holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextSecondary)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
        holder.rating.alpha = if (focused) 1f else .92f
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.image)
        holder.image.setImageDrawable(null)
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        holder.itemView.translationZ = 0f
        super.onViewRecycled(holder)
    }

    override fun onViewDetachedFromWindow(holder: Holder) {
        ArtworkLoader.cancel(holder.image)
        super.onViewDetachedFromWindow(holder)
    }

    override fun getItemCount(): Int = items.size

    internal class Holder(itemView: View, val image: ImageView, val title: TextView, val meta: TextView, val rating: TextView) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF5A3187.toInt(), 0xFF20142B.toInt()) else intArrayOf(0xFF1D1428.toInt(), 0xFF120D1A.toInt())
    ).apply {
        cornerRadius = 14f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF3A2B47.toInt())
    }
}
