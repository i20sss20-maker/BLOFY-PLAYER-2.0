package tv.blofy.player.ui.catalog

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
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
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
    }

    override fun getItemId(position: Int) = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            setPadding(dp(6), dp(6), dp(6), dp(9))
            background = card(false, density)
            clipChildren = false
            clipToPadding = false
            alpha = 0.98f
        }

        val frame = FrameLayout(parent.context).apply {
            clipToOutline = true
        }
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF17101F.toInt())
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(248)))

        val bottomFade = View(parent.context).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0x00100A17, 0xB80B0710.toInt())
            )
        }
        frame.addView(bottomFade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(70), Gravity.BOTTOM))

        val rating = TextView(parent.context).apply {
            textSize = 11f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xE5662CB0.toInt())
                setStroke(dp(1), 0xFFDAB8FF.toInt())
            }
        }
        frame.addView(
            rating,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
                topMargin = dp(9)
                marginEnd = dp(9)
            }
        )
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(248)))

        val title = TextView(parent.context).apply {
            textSize = 14f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            gravity = Gravity.END
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(5), dp(9), dp(5), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        val meta = TextView(parent.context).apply {
            textSize = 11.5f
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            setTextColor(0xFFBDAFC9.toInt())
            gravity = Gravity.END
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(5), dp(2), dp(5), 0)
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(27)))

        return Holder(root, image, title, meta, rating)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        val density = holder.itemView.resources.displayMetrics.density

        resetVisualState(holder, density)
        holder.itemView.tag = item.key
        holder.itemView.contentDescription = buildString {
            append(item.name)
            item.year?.takeIf(String::isNotBlank)?.let { append("، ").append(it) }
            item.rating?.takeIf(String::isNotBlank)?.let { append("، التقييم ").append(it) }
        }
        holder.title.text = item.name
        holder.meta.text = listOfNotNull(
            item.year?.takeIf(String::isNotBlank),
            item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')
        ).joinToString("  •  ")
        holder.rating.apply {
            val value = item.rating?.takeIf(String::isNotBlank)
            visibility = if (value == null) View.GONE else View.VISIBLE
            text = value?.let { "★ $it" }.orEmpty()
        }

        ArtworkLoader.load(holder.image, listOf(item.icon, item.backdrop))
        if (position % 4 == 0) {
            ArtworkLoader.prefetch(
                holder.itemView.context,
                (position + 1 until minOf(items.size, position + 11))
                    .flatMap { index -> listOf(items[index].icon, items[index].backdrop) }
            )
        }

        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(focused, density)
            holder.title.setTextColor(if (focused) 0xFFF8F0FF.toInt() else Color.WHITE)
            holder.meta.setTextColor(if (focused) 0xFFE0CDED.toInt() else 0xFFBDAFC9.toInt())
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.05f else 1f)
                .scaleY(if (focused) 1.05f else 1f)
                .alpha(1f)
                .translationZ(if (focused) 18f * density else 2f * density)
                .setDuration(if (focused) 120L else 90L)
                .start()
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        val density = holder.itemView.resources.displayMetrics.density
        holder.itemView.animate().cancel()
        resetVisualState(holder, density)
        holder.itemView.setOnClickListener(null)
        holder.itemView.setOnFocusChangeListener(null)
        holder.itemView.contentDescription = null
        holder.itemView.tag = null
        holder.image.tag = null
        holder.image.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    private fun resetVisualState(holder: Holder, density: Float) {
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        holder.itemView.alpha = 0.98f
        holder.itemView.translationZ = 2f * density
        holder.itemView.background = card(false, density)
        holder.title.setTextColor(Color.WHITE)
        holder.meta.setTextColor(0xFFBDAFC9.toInt())
    }

    override fun getItemCount() = items.size

    internal class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView
    ) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean, density: Float) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(0xFF6B2EA8.toInt(), 0xFF24142E.toInt())
        } else {
            intArrayOf(0xE8171220.toInt(), 0xF00B0910.toInt())
        }
    ).apply {
        cornerRadius = 18f * density
        setStroke(
            if (focused) (2.2f * density).toInt().coerceAtLeast(2) else (1f * density).toInt().coerceAtLeast(1),
            if (focused) 0xFFE7C8FF.toInt() else 0x3F5A446D
        )
    }
}
