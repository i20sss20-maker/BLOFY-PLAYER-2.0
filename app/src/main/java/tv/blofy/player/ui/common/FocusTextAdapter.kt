package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
            override fun getOldListSize(): Int = oldItems.size
            override fun getNewListSize(): Int = nextItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                val oldItem = oldItems[oldItemPosition]
                val newItem = nextItems[newItemPosition]
                return if (keyOf != null) keyOf(oldItem) == keyOf(newItem) else oldItem == newItem
            }
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean =
                oldItems[oldItemPosition] == nextItems[newItemPosition]
        }, false)
        items.clear()
        items.addAll(nextItems)
        focusedPosition = when {
            previousKey != null && keyOf != null -> items.indexOfFirst { keyOf(it) == previousKey }
            focusedPosition != RecyclerView.NO_POSITION && items.isNotEmpty() -> focusedPosition.coerceIn(0, items.lastIndex)
            else -> RecyclerView.NO_POSITION
        }
        if (focusedPosition < 0) focusedPosition = RecyclerView.NO_POSITION
        restorePending = listOwnedFocus && focusedPosition != RecyclerView.NO_POSITION
        diff.dispatchUpdatesTo(this)
    }

    fun clearFocusMemory() {
        focusedKey = null
        focusedPosition = RecyclerView.NO_POSITION
        restorePending = false
    }

    override fun getItemId(position: Int): Long = itemKey?.invoke(items[position])?.hashCode()?.toLong()
        ?: super.getItemId(position)

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
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val view = TextView(parent.context).apply {
            textSize = 14f
            typeface = Typeface.create(typeface, Typeface.BOLD)
            setTextColor(TEXT_IDLE)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            textDirection = View.TEXT_DIRECTION_RTL
            setPadding(dp(18), 0, dp(18), 0)
            isFocusable = true
            isClickable = true
            isLongClickable = true
            background = background(parent, false)
            setOnFocusChangeListener { v, focused ->
                (v as TextView).setTextColor(if (focused) Color.WHITE else TEXT_IDLE)
                v.animate().cancel()
                v.animate()
                    .scaleX(if (focused) 1.006f else 1f)
                    .scaleY(if (focused) 1.006f else 1f)
                    .translationZ(if (focused) dp(8).toFloat() else 0f)
                    .setDuration(90L)
                    .start()
                v.background = background(parent, focused)
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
        holder.text.text = label(item)
        holder.text.tag = position
        holder.text.setOnClickListener { onClick(item) }
        holder.text.setOnLongClickListener {
            onLongClick?.invoke(item)
            onLongClick != null
        }
        if (restorePending && position == focusedPosition) {
            holder.text.post {
                if (holder.bindingAdapterPosition == focusedPosition && holder.text.visibility == View.VISIBLE) {
                    holder.text.requestFocus()
                    restorePending = false
                }
            }
        }
    }

    override fun getItemCount(): Int = items.size
    inner class Holder(val text: TextView) : RecyclerView.ViewHolder(text)

    private fun background(parent: ViewGroup, focused: Boolean): GradientDrawable {
        val density = parent.resources.displayMetrics.density
        return GradientDrawable().apply {
            setColor(if (focused) PANEL_SOFT else Color.TRANSPARENT)
            cornerRadius = 13f * density
            if (focused) setStroke((2f * density).toInt().coerceAtLeast(1), PURPLE_LIGHT)
        }
    }

    companion object {
        private val TEXT_IDLE = Color.rgb(213, 210, 221)
        private val PANEL_SOFT = Color.rgb(38, 25, 68)
        private val PURPLE_LIGHT = Color.rgb(188, 132, 255)
    }
}
