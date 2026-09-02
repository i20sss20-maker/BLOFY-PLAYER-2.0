package tv.blofy.player.ui.series

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
import tv.blofy.player.R
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

internal class EpisodeCardAdapter(
    private val seriesArt: String?,
    private val onClick: (EpisodeEntity) -> Unit,
    private val onFocus: (EpisodeEntity) -> Unit
) : RecyclerView.Adapter<EpisodeCardAdapter.Holder>() {
    private val items = mutableListOf<EpisodeEntity>()
    private var progress = emptyMap<String, Int>()

    init { setHasStableIds(true) }

    fun submit(newItems: List<EpisodeEntity>) {
        val old = items.toList()
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = old.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition].key == newItems[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition] == newItems[newItemPosition]
        }, false)
        items.clear(); items.addAll(newItems); diff.dispatchUpdatesTo(this)
    }

    fun setProgress(values: Map<String, Int>) {
        progress = values.toMap()
        if (itemCount > 0) notifyItemRangeChanged(0, itemCount, "progress")
    }

    override fun getItemId(position: Int) = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val d = parent.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val row = LinearLayout(parent.context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(9), dp(12), dp(9))
            isFocusable = true; isClickable = true
            background = card(false)
        }
        val frame = FrameLayout(parent.context)
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF16101F.toInt())
        }
        frame.addView(image, FrameLayout.LayoutParams(dp(128), dp(76)))
        val number = TextView(parent.context).apply {
            textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(0xDB7137BA.toInt()) }
        }
        frame.addView(number, FrameLayout.LayoutParams(dp(45), dp(28), Gravity.BOTTOM or Gravity.END).apply { marginEnd = dp(6); bottomMargin = dp(6) })
        row.addView(frame, LinearLayout.LayoutParams(dp(128), dp(76)).apply { marginStart = dp(14) })
        val textBox = LinearLayout(parent.context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        val title = TextView(parent.context).apply {
            textSize = 15f; typeface = Typeface.create("sans-serif", Typeface.BOLD); setTextColor(BlofyTvDesign.TextPrimary); maxLines = 1; gravity = Gravity.RIGHT
        }
        val meta = TextView(parent.context).apply {
            textSize = 12f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1; gravity = Gravity.RIGHT
        }
        textBox.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        textBox.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(24)))
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(76), 1f))
        val state = TextView(parent.context).apply {
            textSize = 12f; typeface = BlofyTvDesign.BodyTypeface; setTextColor(BlofyTvDesign.Mint); gravity = Gravity.CENTER
        }
        row.addView(state, LinearLayout.LayoutParams(dp(110), dp(60)))
        return Holder(row, image, number, title, meta, state)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val e = items[position]
        holder.number.text = "E${e.episode}"
        holder.title.text = e.title.ifBlank { "الحلقة ${e.episode}" }
        val duration = e.durationSecs?.takeIf { it > 0 }?.let { secs -> "${secs / 60} دقيقة" }
        holder.meta.text = listOfNotNull("الموسم ${e.season}", duration).joinToString("  •  ")
        val pct = progress[e.key] ?: 0
        holder.state.text = when {
            pct >= 100 -> "✓ تمت"
            pct > 0 -> "استئناف $pct%"
            else -> "تشغيل ▶"
        }
        if (!seriesArt.isNullOrBlank()) ArtworkLoader.load(holder.image, seriesArt) else holder.image.setImageResource(R.drawable.blofy_logo)
        holder.itemView.setOnClickListener { onClick(e) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.background = card(focused)
            holder.title.setTextColor(Color.WHITE)
            holder.meta.setTextColor(if (focused) 0xFFE8D8FA.toInt() else BlofyTvDesign.TextMuted)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.018f else 1f).scaleY(if (focused) 1.018f else 1f).translationZ(if (focused) 12f else 1f).setDuration(80).start()
            if (focused) onFocus(e)
        }
    }

    override fun getItemCount() = items.size

    internal class Holder(item: View, val image: ImageView, val number: TextView, val title: TextView, val meta: TextView, val state: TextView) : RecyclerView.ViewHolder(item)

    private fun card(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF63379E.toInt(), 0xFF2E1B43.toInt()) else intArrayOf(0xFF251A35.toInt(), 0xFF17111F.toInt())
    ).apply {
        cornerRadius = 20f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF49375E.toInt())
    }
}
