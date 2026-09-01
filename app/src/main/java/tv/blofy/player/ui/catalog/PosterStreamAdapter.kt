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
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.StreamEntity

internal class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit = {}
) : RecyclerView.Adapter<PosterStreamAdapter.Holder>() {
    private val items = mutableListOf<StreamEntity>()

    init { setHasStableIds(true) }

    fun submit(newItems: List<StreamEntity>) {
        val oldItems = items.toList()
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = oldItems.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = oldItems[oldItemPosition].key == newItems[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = oldItems[oldItemPosition] == newItems[newItemPosition]
        }, false)
        items.clear(); items.addAll(newItems); diff.dispatchUpdatesTo(this)
    }

    override fun getItemId(position: Int) = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true; isClickable = true
            setPadding(dp(6), dp(6), dp(6), dp(9))
            background = card(false)
            clipToOutline = true
        }
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(CLASSIC_SURFACE)
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))
        val rating = TextView(parent.context).apply {
            textSize = 11f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.argb(220, 18, 16, 29))
                setStroke(dp(1), CLASSIC_PURPLE_SOFT)
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(8); marginEnd = dp(8)
        })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))
        val title = TextView(parent.context).apply {
            textSize = 14f; typeface = Typeface.create("sans-serif", Typeface.BOLD); setTextColor(Color.WHITE)
            gravity = Gravity.START; maxLines = 2; setPadding(dp(4), dp(8), dp(4), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        val meta = TextView(parent.context).apply {
            textSize = 11f; setTextColor(CLASSIC_MUTED); gravity = Gravity.START; maxLines = 1
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
        if (position % 4 == 0) {
            ArtworkLoader.prefetch(holder.itemView.context, (position + 1 until minOf(items.size, position + 9)).map { index -> items[index].icon ?: items[index].backdrop })
        }
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(focused)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.03f else 1f).scaleY(if (focused) 1.03f else 1f).translationZ(if (focused) 10f else 2f).setDuration(75).start()
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.image.tag = null; holder.image.setImageDrawable(null); super.onViewRecycled(holder)
    }

    override fun getItemCount() = items.size

    internal class Holder(itemView: View, val image: ImageView, val title: TextView, val meta: TextView, val rating: TextView) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(if (focused) CLASSIC_FOCUS else CLASSIC_SURFACE)
        setStroke(if (focused) 2 else 1, if (focused) CLASSIC_FOCUS_STROKE else CLASSIC_STROKE)
    }

    companion object {
        private val CLASSIC_SURFACE = Color.rgb(18, 16, 29)
        private val CLASSIC_FOCUS = Color.rgb(50, 22, 79)
        private val CLASSIC_FOCUS_STROKE = Color.rgb(225, 184, 255)
        private val CLASSIC_STROKE = Color.argb(85, 77, 55, 107)
        private val CLASSIC_PURPLE_SOFT = Color.rgb(195, 135, 255)
        private val CLASSIC_MUTED = Color.rgb(169, 167, 179)
    }
}
