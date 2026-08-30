package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class FocusTextAdapter<T>(
    private val label: (T) -> String,
    private val onClick: (T) -> Unit,
    private val onFocus: ((T) -> Unit)? = null,
    private val onLongClick: ((T) -> Unit)? = null
) : RecyclerView.Adapter<FocusTextAdapter<T>.Holder>() {
    private val items = mutableListOf<T>()

    fun submit(newItems: List<T>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val view = TextView(parent.context).apply {
            textSize = 17f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(22, 0, 22, 0)
            isFocusable = true
            isClickable = true
            isLongClickable = true
            background = background(false)
            setOnFocusChangeListener { v, focused ->
                v.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(110).start()
                v.background = background(focused)
                if (focused) (v.tag as? Int)?.let { pos -> items.getOrNull(pos)?.let { onFocus?.invoke(it) } }
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
    }

    override fun getItemCount(): Int = items.size

    inner class Holder(val text: TextView) : RecyclerView.ViewHolder(text)

    private fun background(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 16f
        setColor(if (focused) Color.rgb(75, 38, 126) else Color.rgb(18, 17, 28))
        if (focused) setStroke(2, Color.rgb(180, 130, 255))
    }
}
