package tv.blofy.player.ui.common

import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView

class FocusTextAdapter<T : Any>(
    private val label: (T) -> String,
    private val onClick: (T) -> Unit,
    private val onFocus: ((T) -> Unit)? = null,
    private val onLongClick: ((T) -> Unit)? = null,
    private val itemKey: ((T) -> String)? = null
) : RecyclerView.Adapter<FocusTextAdapter<T>.Holder>() {
    private val differ = AsyncListDiffer(this, object : DiffUtil.ItemCallback<T>() {
        override fun areItemsTheSame(o: T, n: T) = itemKey?.let { it(o) == it(n) } ?: (label(o) == label(n))
        override fun areContentsTheSame(o: T, n: T) = label(o) == label(n)
    })
    private val items get() = differ.currentList
    private var focusedKey: String? = null
    private var focusedPosition = RecyclerView.NO_POSITION
    private var restorePending = false
    private var attached: RecyclerView? = null

    init { setHasStableIds(itemKey != null) }

    fun submit(newItems: List<T>) {
        if (sameVisibleList(newItems)) return
        val owned = attached?.hasFocus() == true
        val previousKey = focusedKey
        val previousPosition = focusedPosition
        differ.submitList(newItems.toList()) {
            focusedPosition = when {
                previousKey != null && itemKey != null -> items.indexOfFirst { itemKey.invoke(it) == previousKey }
                previousPosition != RecyclerView.NO_POSITION && items.isNotEmpty() -> previousPosition.coerceIn(0, items.lastIndex)
                else -> RecyclerView.NO_POSITION
            }
            if (focusedPosition < 0) focusedPosition = RecyclerView.NO_POSITION
            restorePending = owned && attached?.hasFocus() == true && focusedPosition != RecyclerView.NO_POSITION
            if (restorePending) attached?.post { restoreFocusedView() }
        }
    }

    private fun sameVisibleList(newItems: List<T>): Boolean {
        if (items.size != newItems.size) return false
        val key = itemKey
        return items.indices.all { index ->
            val old = items[index]
            val new = newItems[index]
            if (key != null) key(old) == key(new) && label(old) == label(new)
            else label(old) == label(new)
        }
    }

    fun indexOfKey(key: String?): Int {
        val resolver = itemKey ?: return -1
        if (key.isNullOrBlank()) return -1
        return items.indexOfFirst { resolver(it) == key }
    }

    fun focusedIndex(): Int = focusedPosition

    fun requestFocusAt(position: Int): Boolean {
        if (position !in items.indices) return false
        focusedPosition = position
        focusedKey = itemKey?.invoke(items[position])
        restorePending = false
        return attached?.let { TwoPaneFocusGuard.focusItem(it, position) } ?: false
    }

    fun clearFocusMemory() {
        focusedKey = null
        focusedPosition = RecyclerView.NO_POSITION
        restorePending = false
    }

    override fun getItemId(position: Int) = itemKey?.invoke(items[position])?.hashCode()?.toLong() ?: super.getItemId(position)

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        attached = recyclerView
        recyclerView.preserveFocusAfterLayout = true
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        if (attached === recyclerView) attached = null
        restorePending = false
        super.onDetachedFromRecyclerView(recyclerView)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        val view = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 13f)
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            layoutDirection = context.resources.configuration.layoutDirection
            setPadding(TvUiTuning.dp(context, 16), 0, TvUiTuning.dp(context, 16), 0)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = CinemaStyle.surface(context, filledFocus = true)
        }
        view.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, TvUiTuning.dp(context, 46)).apply {
            bottomMargin = TvUiTuning.dp(context, 6)
            marginStart = TvUiTuning.dp(context, 3)
            marginEnd = TvUiTuning.dp(context, 3)
        }
        return Holder(view).also { holder ->
            view.setOnFocusChangeListener { focusedView, focused ->
                val text = focusedView as TextView
                focusedView.animate().cancel()
                focusedView.scaleX = 1f
                focusedView.scaleY = 1f
                focusedView.translationZ = if (focused) TvUiTuning.dp(context, 4).toFloat() else 0f
                text.typeface = if (focused) BlofyTvDesign.LabelTypeface else BlofyTvDesign.MediumTypeface
                text.setTextColor(if (focused) CinemaStyle.Background else CinemaStyle.White)
                focusedView.background = CinemaStyle.surface(context, focused, filledFocus = true)
                if (focused) {
                    restorePending = false
                    val position = holder.bindingAdapterPosition
                    items.getOrNull(position)?.let { item ->
                        focusedPosition = position
                        focusedKey = itemKey?.invoke(item)
                        onFocus?.invoke(item)
                    }
                }
            }
        }
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.text.text = label(item)
        if (!holder.text.hasFocus()) {
            holder.text.typeface = BlofyTvDesign.MediumTypeface
            holder.text.setTextColor(BlofyTvDesign.TextSecondary)
        }
        holder.text.background = CinemaStyle.surface(holder.text.context, holder.text.hasFocus(), filledFocus = true)
        holder.text.setOnClickListener { onClick(item) }
        holder.text.setOnLongClickListener { onLongClick?.invoke(item); onLongClick != null }
        if (restorePending && position == focusedPosition) {
            holder.text.post {
                if (restorePending && attached?.hasFocus() == true &&
                    holder.bindingAdapterPosition == focusedPosition && holder.text.visibility == View.VISIBLE) {
                    holder.text.requestFocus()
                    restorePending = false
                }
            }
        }
    }

    override fun getItemCount() = items.size
    inner class Holder(val text: TextView) : RecyclerView.ViewHolder(text)

    private fun restoreFocusedView() {
        val recycler = attached ?: return
        if (!restorePending || !recycler.hasFocus()) { restorePending = false; return }
        val position = focusedPosition
        if (position == RecyclerView.NO_POSITION || position !in items.indices) return
        val existing = recycler.findViewHolderForAdapterPosition(position)?.itemView
        if (existing != null) {
            existing.requestFocus()
            restorePending = false
        } else {
            recycler.scrollToPosition(position)
            recycler.post {
                if (restorePending && recycler.hasFocus() && position == focusedPosition) {
                    recycler.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus()
                }
                restorePending = false
            }
        }
    }

}
