package tv.blofy.player.ui.common

import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView

class FocusTextAdapter<T>(
    private val label: (T) -> String,
    private val onClick: (T) -> Unit,
    private val onFocus: ((T) -> Unit)? = null,
    private val onLongClick: ((T) -> Unit)? = null,
    private val itemKey: ((T) -> String)? = null
) : RecyclerView.Adapter<FocusTextAdapter<T>.Holder>() {
    private val items = mutableListOf<T>()
    private var focusedKey: String? = null
    private var focusedPosition: Int = RecyclerView.NO_POSITION
    private var restorePending = false
    private var attachedRecyclerView: RecyclerView? = null

    init { setHasStableIds(itemKey != null) }

    fun submit(newItems: List<T>) {
        val listOwnedFocus = attachedRecyclerView?.hasFocus() == true
        val previousKey = focusedKey
        val oldItems = items.toList()
        val nextItems = newItems.toList()
        val keyOf = itemKey
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = oldItems.size
            override fun getNewListSize() = nextItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                val oldItem = oldItems[oldItemPosition]
                val newItem = nextItems[newItemPosition]
                return if (keyOf != null) keyOf(oldItem) == keyOf(newItem) else oldItem == newItem
            }
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = oldItems[oldItemPosition] == nextItems[newItemPosition]
        }, false)
        items.clear(); items.addAll(nextItems)
        focusedPosition = when {
            previousKey != null && keyOf != null -> items.indexOfFirst { keyOf(it) == previousKey }
            focusedPosition != RecyclerView.NO_POSITION && items.isNotEmpty() -> focusedPosition.coerceIn(0, items.lastIndex)
            else -> RecyclerView.NO_POSITION
        }
        if (focusedPosition < 0) focusedPosition = RecyclerView.NO_POSITION
        restorePending = listOwnedFocus && focusedPosition != RecyclerView.NO_POSITION
        diff.dispatchUpdatesTo(this)
    }

    fun clearFocusMemory() { focusedKey = null; focusedPosition = RecyclerView.NO_POSITION; restorePending = false }

    override fun getItemId(position: Int): Long = itemKey?.invoke(items[position])?.hashCode()?.toLong() ?: super.getItemId(position)

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        attachedRecyclerView = recyclerView
        recyclerView.layoutDirection = View.LAYOUT_DIRECTION_RTL
        recyclerView.textDirection = View.TEXT_DIRECTION_RTL
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        if (attachedRecyclerView === recyclerView) attachedRecyclerView = null
        restorePending = false
        super.onDetachedFromRecyclerView(recyclerView)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val view = TextView(parent.context).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            textDirection = View.TEXT_DIRECTION_RTL
            textSize = 14.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(18), 0, dp(18), 0)
            minHeight = dp(58)
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = BlofyTvDesign.surface(dp(15).toFloat(), false)
            setOnFocusChangeListener { v, focused ->
                val text = v as TextView
                text.setTextColor(if (focused) BlofyTvDesign.PurpleDeep else BlofyTvDesign.TextSecondary)
                text.typeface = if (focused) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
                v.animate().cancel()
                v.animate()
                    .scaleX(if (focused) 1.018f else 1f)
                    .scaleY(if (focused) 1.018f else 1f)
                    .translationZ(if (focused) dp(12).toFloat() else dp(2).toFloat())
                    .setDuration(if (focused) 100L else 80L)
                    .start()
                v.background = BlofyTvDesign.surface(dp(15).toFloat(), focused)
                if (focused) {
                    (v.tag as? Int)?.let { pos ->
                        items.getOrNull(pos)?.let { item ->
                            focusedPosition = pos
                            focusedKey = itemKey?.invoke(item)
                            onFocus?.invoke(item)
                        }
                    }
                }
            }
        }
        return Holder(view)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        val density = holder.text.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        holder.text.animate().cancel()
        holder.text.scaleX = 1f
        holder.text.scaleY = 1f
        holder.text.translationZ = 2f * density
        holder.text.background = BlofyTvDesign.surface(dp(15).toFloat(), false)
        holder.text.setTextColor(BlofyTvDesign.TextSecondary)
        holder.text.typeface = BlofyTvDesign.BodyTypeface
        holder.text.text = label(item)
        holder.text.tag = position
        holder.text.setOnClickListener { onClick(item) }
        holder.text.setOnLongClickListener { onLongClick?.invoke(item); onLongClick != null }
        if (restorePending && position == focusedPosition) {
            holder.text.post {
                if (holder.bindingAdapterPosition == focusedPosition && holder.text.visibility == View.VISIBLE) {
                    holder.text.requestFocus(); restorePending = false
                }
            }
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.text.animate().cancel()
        holder.text.scaleX = 1f
        holder.text.scaleY = 1f
        holder.text.translationZ = 0f
        holder.text.tag = null
        holder.text.setOnClickListener(null)
        holder.text.setOnLongClickListener(null)
        super.onViewRecycled(holder)
    }

    override fun getItemCount() = items.size
    inner class Holder(val text: TextView) : RecyclerView.ViewHolder(text)
}
