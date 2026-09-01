package tv.blofy.player.ui.catalog

import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.V339Ui

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
        val context = parent.context
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            isFocusable = true
            isClickable = true
            setPadding(dp(context, 2), dp(context, 2), dp(context, 2), dp(context, 3))
            background = V339Ui.focusDrawable(context, android.graphics.Color.rgb(15, 13, 27), V339Ui.PANEL_SOFT, V339Ui.PURPLE_LIGHT)
            clipChildren = false
            clipToPadding = false
        }
        V339Ui.attachScaleFocus(root, 1.035f)

        val image = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
        }
        root.addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 194)))

        val title = V339Ui.title(context, "", 11f).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 42)))

        val meta = V339Ui.text(context, "", 9f, V339Ui.MUTED).apply {
            gravity = Gravity.LEFT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_LTR
            isSingleLine = true
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 24)))

        root.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(context, 6), dp(context, 5), dp(context, 6), dp(context, 7))
        }
        return Holder(root, image, title, meta)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.itemView.tag = item.key
        holder.title.text = item.name
        holder.meta.text = buildList {
            item.releaseDate?.takeIf(String::isNotBlank)?.let(::add)
                ?: item.year?.takeIf(String::isNotBlank)?.let(::add)
            item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
            add(if (item.kind == "series") "مسلسل" else "فيلم")
        }.joinToString("  •  ")
        ArtworkLoader.load(holder.image, item.icon ?: item.backdrop)
        if (position % 4 == 0) {
            ArtworkLoader.prefetch(holder.itemView.context, (position + 1 until minOf(items.size, position + 9)).map { index -> items[index].icon ?: items[index].backdrop })
        }
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.035f else 1f).scaleY(if (focused) 1.035f else 1f).setDuration(90L).start()
            view.elevation = if (focused) dp(view.context, 8).toFloat() else 0f
            if (focused) onFocus(item)
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.image.tag = null
        holder.image.setImageDrawable(null)
        super.onViewRecycled(holder)
    }

    override fun getItemCount() = items.size

    internal class Holder(itemView: View, val image: ImageView, val title: TextView, val meta: TextView) : RecyclerView.ViewHolder(itemView)

    private fun dp(context: android.content.Context, value: Int) = V339Ui.dp(context, value)
}
