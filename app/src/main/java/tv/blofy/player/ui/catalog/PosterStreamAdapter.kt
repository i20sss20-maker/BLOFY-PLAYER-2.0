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

class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity, Int) -> Unit = { _, _ -> }
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
            setPadding(dp(5), dp(5), dp(5), dp(6))
            background = card(false, dp(16).toFloat(), dp(1))
            clipToOutline = true
            elevation = 0f
        }
        root.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            marginStart = dp(4)
            marginEnd = dp(4)
            bottomMargin = dp(10)
        }
        val frame = object : FrameLayout(parent.context) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
                val width = View.MeasureSpec.getSize(widthMeasureSpec)
                super.onMeasure(widthMeasureSpec, View.MeasureSpec.makeMeasureSpec(width * 3 / 2, View.MeasureSpec.EXACTLY))
            }
        }
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.rgb(18, 13, 25))
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val rating = TextView(parent.context).apply {
            textSize = 9.2f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(7), dp(2), dp(7), dp(2))
            visibility = View.GONE
            background = GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(0xE5522B78.toInt())
                setStroke(dp(1), 0xFFB77BEA.toInt())
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { topMargin = dp(7); marginEnd = dp(7) })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val title = TextView(parent.context).apply {
            textSize = 11.3f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(4), dp(6), dp(4), 0)
            includeFontPadding = false
        }
        val titleHeight = maxOf(dp(36), title.lineHeight * 2 + title.paddingTop + title.paddingBottom)
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, titleHeight))
        val meta = TextView(parent.context).apply {
            textSize = 9.3f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(4), 0, dp(4), 0)
            includeFontPadding = false
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(18)))
        return Holder(root, image, title, meta, rating, dp(16).toFloat(), dp(1))
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
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.animate().cancel()
            view.scaleX = 1f
            view.scaleY = 1f
            view.translationZ = if (focused) 4f else 0f
            renderFocus(holder, focused)
            if (focused) {
                val currentPosition = holder.bindingAdapterPosition
                if (currentPosition != RecyclerView.NO_POSITION) onFocus(item, currentPosition)
            }
        }
    }

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = card(focused, holder.radius, holder.stroke)
        holder.title.typeface = if (focused) BlofyTvDesign.LabelTypeface else BlofyTvDesign.MediumTypeface
        holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextSecondary)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextMuted)
        holder.rating.alpha = if (focused) 1f else .9f
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

    class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView,
        val radius: Float,
        val stroke: Int
    ) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean, radius: Float, stroke: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF4B2D69.toInt(), 0xFF241730.toInt(), 0xFF16101D.toInt())
        else intArrayOf(0xFF1A1423.toInt(), 0xFF120E19.toInt(), 0xFF0E0B12.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) stroke * 2 else stroke, if (focused) 0xFFD5B4F3.toInt() else 0xFF352A40.toInt())
    }
}
