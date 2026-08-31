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

internal class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit = {}
) : RecyclerView.Adapter<PosterStreamAdapter.Holder>() {
    private val items = mutableListOf<StreamEntity>()

    fun submit(newItems: List<StreamEntity>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

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
        }
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.rgb(20, 15, 31))
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))
        val rating = TextView(parent.context).apply {
            textSize = 11f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(4), dp(8), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(11).toFloat()
                setColor(Color.argb(225, 62, 27, 105))
                setStroke(dp(1), Color.rgb(189, 129, 255))
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(8)
            marginEnd = dp(8)
        })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(245)))
        val title = TextView(parent.context).apply {
            textSize = 14f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            maxLines = 2
            setPadding(dp(4), dp(9), dp(4), 0)
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        val meta = TextView(parent.context).apply {
            textSize = 11f
            setTextColor(Color.rgb(183, 168, 201))
            gravity = Gravity.START
            maxLines = 1
            setPadding(dp(4), dp(2), dp(4), 0)
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(27)))
        return Holder(root, image, title, meta, rating)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.itemView.tag = item
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
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(focused)
            view.animate()
                .scaleX(if (focused) 1.045f else 1f)
                .scaleY(if (focused) 1.045f else 1f)
                .translationZ(if (focused) 18f else 3f)
                .setDuration(120)
                .start()
            if (focused) onFocus(item)
        }
    }

    override fun getItemCount(): Int = items.size

    internal class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView
    ) : RecyclerView.ViewHolder(itemView)

    private fun card(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF5D2498.toInt(), 0xFF241330.toInt())
        else intArrayOf(0xED181321.toInt(), 0xF00C0A12.toInt())
    ).apply {
        cornerRadius = 20f
        setStroke(if (focused) 3 else 1, if (focused) 0xFFE0B5FF.toInt() else 0x554D376B)
    }
}
