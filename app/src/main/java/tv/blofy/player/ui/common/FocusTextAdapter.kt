package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
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

    init {
        setHasStableIds(itemKey != null)
    }

    fun submit(newItems: List<T>) {
        val listOwnedFocus = attachedRecyclerView?.hasFocus() == true
        val previousKey = focusedKey
        items.clear()
        items.addAll(newItems)
        focusedPosition = when {
            previousKey != null && itemKey != null -> items.indexOfFirst { itemKey.invoke(it) == previousKey }
            focusedPosition != RecyclerView.NO_POSITION && items.isNotEmpty() -> focusedPosition.coerceIn(0, items.lastIndex)
            else -> RecyclerView.NO_POSITION
        }
        restorePending = listOwnedFocus && focusedPosition != RecyclerView.NO_POSITION
        notifyDataSetChanged()
    }

    fun clearFocusMemory() {
        focusedKey = null
        focusedPosition = RecyclerView.NO_POSITION
        restorePending = false
    }

    override fun getItemId(position: Int): Long {
        val key = itemKey ?: return super.getItemId(position)
        return key(items[position]).hashCode().toLong()
    }

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
            textSize = 17f
            setTextColor(TEXT_IDLE)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(22, 0, 22, 0)
            isFocusable = true
            isClickable = true
            isLongClickable = true
            background = background(false)
            setOnFocusChangeListener { v, focused ->
                (v as TextView).setTextColor(if (focused) Color.WHITE else TEXT_IDLE)
                v.animate()
                    .scaleX(if (focused) 1.025f else 1f)
                    .scaleY(if (focused) 1.025f else 1f)
                    .translationZ(if (focused) 12f else 2f)
                    .setDuration(110)
                    .start()
                v.background = background(focused)
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

    private fun background(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF7930D7.toInt(), 0xFF32164F.toInt())
        else intArrayOf(0xD91C162C.toInt(), 0xE8110E1B.toInt())
    ).apply {
        cornerRadius = 16f
        setStroke(if (focused) 2 else 1, if (focused) 0xFFE1B8FF.toInt() else 0x554D376B)
    }

    companion object {
        private val TEXT_IDLE = Color.rgb(232, 226, 239)
    }
}
