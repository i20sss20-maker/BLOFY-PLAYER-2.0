package tv.blofy.player.ui.catalog

import android.graphics.Color
import android.graphics.Typeface
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

    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)

    override fun getItemId(position: Int): Long = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isClickable = true
            setPadding(dp(7), dp(7), dp(7), dp(10))
            background = card(false)
            clipToOutline = true
            elevation = dp(2).toFloat()
        }
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.rgb(20, 15, 31))
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(250)))
        val rating = TextView(parent.context).apply {
            textSize = 11.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(11).toFloat()
                setColor(0xE85A2A82.toInt())
                setStroke(dp(1), BlofyTvDesign.PurpleBright)
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(8); marginEnd = dp(8)
        })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(250)))
        val title = TextView(parent.context).apply {
            textSize = 14f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            maxLines = 2
            setPadding(dp(4), dp(9), dp(4), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        val meta = TextView(parent.context).apply {
            textSize = 11.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            maxLines = 1
            setPadding(dp(4), dp(2), dp(4), 0)
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(27)))
        return Holder(root, image, title, meta, rating)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.itemView.tag = item.key
        holder.title.text = item.name
        holder.meta.text = listOfNotNull(item.year?.takeIf(String::isNotBlank), item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')).joinToString("  •  ")
        holder.rating.apply {
            val value = item.rating?.takeIf(String::isNotBlank)
            visibility = if (value == null) View.GONE else View.VISIBLE
            text = value?.let { "★ $it" }.orEmpty()
        }
        ArtworkLoader.load(holder.image, item.icon ?: item.backdrop)
        if (position % 5 == 0) {
            val next = (position + 1 until minOf(items.size, position + 11)).map { index -> items[index].icon ?: items[index].backdrop }
            ArtworkLoader.prefetch(holder.itemView.context, next)
        }
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(focused)
            holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextPrimary)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).translationZ(if (focused) 14f else 2f).setDuration(85).start()
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.image.tag = null
        holder.image.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    override fun getItemCount(): Int = items.size

    internal class Holder(itemView: View, val image: ImageView, val title: TextView, val meta: TextView, val rating: TextView) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF62379B.toInt(), 0xFF25172F.toInt()) else intArrayOf(0xFF241A32.toInt(), 0xFF15101E.toInt())
    ).apply {
        cornerRadius = 20f
        setStroke(if (focused) 3 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF49375E.toInt())
    }
}
