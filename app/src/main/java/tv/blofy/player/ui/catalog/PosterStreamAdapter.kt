package tv.blofy.player.ui.catalog

import android.graphics.Color
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
import tv.blofy.player.ui.common.BlofyTvDesign

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
            setPadding(dp(5), dp(5), dp(5), dp(7))
            background = BlofyTvDesign.surface(dp(17).toFloat(), false)
            clipChildren = false
            clipToPadding = false
            alpha = 0.99f
            elevation = dp(2).toFloat()
        }

        val frame = FrameLayout(parent.context).apply { clipToOutline = true }
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(222)))

        val bottomFade = View(parent.context).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00100A17, 0xD00A0710.toInt()))
        }
        frame.addView(bottomFade, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62), Gravity.BOTTOM))

        val rating = TextView(parent.context).apply {
            textSize = 10.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(7), dp(3), dp(7), dp(3))
            background = BlofyTvDesign.badge(dp(11).toFloat())
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(7)
            marginEnd = dp(7)
        })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(222)))

        val title = TextView(parent.context).apply {
            textSize = 13.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.END
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(5), dp(7), dp(5), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)))

        val meta = TextView(parent.context).apply {
            textSize = 10.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.END
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(5), 0, dp(5), 0)
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)))

        return Holder(root, image, title, meta, rating)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        val density = holder.itemView.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        resetVisualState(holder, dp(17).toFloat(), density)
        holder.itemView.tag = item.key
        holder.itemView.contentDescription = buildString {
            append(item.name)
            item.year?.takeIf(String::isNotBlank)?.let { append("، ").append(it) }
            item.rating?.takeIf(String::isNotBlank)?.let { append("، التقييم ").append(it) }
        }
        holder.title.text = item.name
        holder.meta.text = listOfNotNull(item.year?.takeIf(String::isNotBlank), item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')).joinToString("  •  ")
        holder.rating.apply {
            val value = item.rating?.takeIf(String::isNotBlank)
            visibility = if (value == null) View.GONE else View.VISIBLE
            text = value?.let { "★ $it" }.orEmpty()
        }

        ArtworkLoader.load(holder.image, listOf(item.icon, item.backdrop))
        if (position < 12 || position % 6 == 0) {
            ArtworkLoader.prefetch(holder.itemView.context, (position + 1 until minOf(items.size, position + 15)).flatMap { index -> listOf(items[index].icon, items[index].backdrop) })
        }

        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = BlofyTvDesign.surface(dp(17).toFloat(), focused)
            holder.meta.setTextColor(if (focused) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.04f else 1f)
                .scaleY(if (focused) 1.04f else 1f)
                .alpha(1f)
                .translationZ(if (focused) 16f * density else 2f * density)
                .setDuration(if (focused) 110L else 80L)
                .start()
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        val density = holder.itemView.resources.displayMetrics.density
        val radius = 17f * density
        holder.itemView.animate().cancel()
        resetVisualState(holder, radius, density)
        holder.itemView.setOnClickListener(null)
        holder.itemView.setOnFocusChangeListener(null)
        holder.itemView.contentDescription = null
        holder.itemView.tag = null
        holder.image.tag = null
        holder.image.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    private fun resetVisualState(holder: Holder, radius: Float, density: Float) {
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        holder.itemView.alpha = 0.99f
        holder.itemView.translationZ = 2f * density
        holder.itemView.background = BlofyTvDesign.surface(radius, false)
        holder.title.setTextColor(BlofyTvDesign.TextPrimary)
        holder.meta.setTextColor(BlofyTvDesign.TextMuted)
    }

    override fun getItemCount() = items.size

    internal class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView
    ) : RecyclerView.ViewHolder(itemView)
}
