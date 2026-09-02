package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView

class FocusTextAdapter<T>(
    private val label: (T) -> String,
    private val onClick: (T) -> Unit,
    private val onFocus: ((T) -> Unit)? = null,
    private val onLongClick: ((T) -> Unit)? = null,
    private val itemKey: ((T) -> String)? = null
) : RecyclerView.Adapter<FocusTextAdapter<T>.Holder>() {
    private val differ = AsyncListDiffer(this, object : DiffUtil.ItemCallback<T>() {
        override fun areItemsTheSame(oldItem: T, newItem: T): Boolean = itemKey?.let { it(oldItem) == it(newItem) } ?: (oldItem == newItem)
        override fun areContentsTheSame(oldItem: T, newItem: T): Boolean = oldItem == newItem
    })
    private val items: List<T> get() = differ.currentList
    private var focusedKey: String? = null
    private var focusedPosition: Int = RecyclerView.NO_POSITION
    private var restorePending = false
    private var attachedRecyclerView: RecyclerView? = null

    init { setHasStableIds(itemKey != null) }

    fun submit(newItems: List<T>) {
        val listOwnedFocus = attachedRecyclerView?.hasFocus() == true
        val previousKey = focusedKey
        val previousPosition = focusedPosition
        differ.submitList(newItems.toList()) {
            focusedPosition = when {
                previousKey != null && itemKey != null -> items.indexOfFirst { itemKey.invoke(it) == previousKey }
                previousPosition != RecyclerView.NO_POSITION && items.isNotEmpty() -> previousPosition.coerceIn(0, items.lastIndex)
                else -> RecyclerView.NO_POSITION
            }
            if (focusedPosition < 0) focusedPosition = RecyclerView.NO_POSITION
            restorePending = listOwnedFocus && focusedPosition != RecyclerView.NO_POSITION
            if (restorePending) attachedRecyclerView?.post {
                attachedRecyclerView?.findViewHolderForAdapterPosition(focusedPosition)?.itemView?.requestFocus()
            }
        }
    }

    fun clearFocusMemory() {
        focusedKey = null
        focusedPosition = RecyclerView.NO_POSITION
        restorePending = false
    }

    override fun getItemId(position: Int): Long = itemKey?.invoke(items[position])?.hashCode()?.toLong() ?: super.getItemId(position)

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        attachedRecyclerView = recyclerView
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        if (attachedRecyclerView === recyclerView) attachedRecyclerView = null
        restorePending = false
        super.onDetachedFromRecyclerView(recyclerView)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = TextView(parent.context).apply {
            textSize = 16.5f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(24, 0, 24, 0)
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = itemBackground(false)
            setOnFocusChangeListener { v, focused ->
                (v as TextView).setTextColor(Color.WHITE)
                v.animate().cancel()
                v.animate().scaleX(if (focused) 1.022f else 1f).scaleY(if (focused) 1.022f else 1f)
                    .translationZ(if (focused) 12f else 2f).setDuration(if (focused) 85L else 70L).start()
                v.background = itemBackground(focused)
                if (focused) {
                    val pos = (v.tag as? Int) ?: RecyclerView.NO_POSITION
                    items.getOrNull(pos)?.let { item ->
                        focusedPosition = pos
                        focusedKey = itemKey?.invoke(item)
                        onFocus?.invoke(item)
                    }
                }
            }
        }
        return Holder(view)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.text.text = label(item)
        holder.text.tag = position
        holder.text.setTextColor(BlofyTvDesign.TextPrimary)
        holder.text.background = itemBackground(holder.text.hasFocus())
        holder.text.setOnClickListener { onClick(item) }
        holder.text.setOnLongClickListener { onLongClick?.invoke(item); onLongClick != null }
        if (restorePending && position == focusedPosition) {
            holder.text.post {
                if (holder.bindingAdapterPosition == focusedPosition && holder.text.visibility == View.VISIBLE) {
                    holder.text.requestFocus()
                    restorePending = false
                }
            }
        }
    }

    override fun getItemCount() = items.size

    inner class Holder(val text: TextView) : RecyclerView.ViewHolder(text)

    private fun itemBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7139BE.toInt(), 0xFF402461.toInt()) else intArrayOf(0xFF241A34.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = 18f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF463455.toInt())
    }
}
