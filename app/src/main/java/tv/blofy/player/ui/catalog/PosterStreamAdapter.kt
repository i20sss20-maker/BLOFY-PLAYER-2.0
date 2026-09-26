package tv.blofy.player.ui.catalog

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
import tv.blofy.player.ui.common.stableId64

internal class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit = {}
) : RecyclerView.Adapter<PosterStreamAdapter.Holder>() {
    private val items = mutableListOf<StreamEntity>()

    init {
        setHasStableIds(true)
    }

    fun submit(newItems: List<StreamEntity>) {
        val oldItems = items.toList()
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = oldItems.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean =
                oldItems[oldItemPosition].key == newItems[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean =
                oldItems[oldItemPosition] == newItems[newItemPosition]
        }, false)
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
    }

    override fun getItemId(position: Int): Long = stableId64(items[position].key)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isClickable = true
            stateListAnimator = null
            setPadding(dp(7), dp(7), dp(7), dp(10))
            background = card(this, false)
            clipToOutline = true
        }

        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))

        val rating = TextView(parent.context).apply {
            textSize = 11f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
            background = BlofyTvDesign.badge(dp(11).toFloat(), accent = true)
        }
        frame.addView(
            rating,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
                topMargin = dp(8)
                marginEnd = dp(8)
            }
        )

        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))

        val title = TextView(parent.context).apply {
            textSize = 14.5f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            maxLines = 2
            setPadding(dp(4), dp(9), dp(4), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        val meta = TextView(parent.context).apply {
            textSize = 11f
            typeface = BlofyTvDesign.BodyTypeface
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
        holder.meta.text = listOfNotNull(
            item.year?.takeIf(String::isNotBlank),
            item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')
        ).joinToString("  •  ")
        holder.rating.apply {
            val value = item.rating?.takeIf(String::isNotBlank)
            visibility = if (value == null) View.GONE else View.VISIBLE
            text = value?.let { "★ $it" }.orEmpty()
        }

        ArtworkLoader.load(holder.image, item.icon ?: item.backdrop)
        if (position % 4 == 0) {
            val next = (position + 1 until minOf(items.size, position + 9)).map { index ->
                items[index].icon ?: items[index].backdrop
            }
            ArtworkLoader.prefetch(holder.itemView.context, next)
        }

        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(view, focused)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.045f else 1f)
                .scaleY(if (focused) 1.045f else 1f)
                .translationZ(if (focused) dp(view, 22).toFloat() else dp(view, 3).toFloat())
                .alpha(if (focused) 1f else .97f)
                .setDuration(if (focused) 110L else 90L)
                .start()
            holder.title.setTextColor(if (focused) BlofyTvDesign.PurpleSoft else BlofyTvDesign.TextPrimary)
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.image.tag = null
        holder.image.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    override fun getItemCount(): Int = items.size

    internal class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView
    ) : RecyclerView.ViewHolder(itemView)

    private fun card(view: View, focused: Boolean) =
        BlofyTvDesign.posterCard(dp(view, 20).toFloat(), focused)

    private fun dp(view: View, value: Int) =
        (value * view.resources.displayMetrics.density).toInt()
}
