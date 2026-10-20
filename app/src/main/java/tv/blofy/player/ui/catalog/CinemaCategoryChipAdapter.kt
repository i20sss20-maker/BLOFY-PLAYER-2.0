package tv.blofy.player.ui.catalog

import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

/** Phone-only horizontal category chips; Android TV keeps the existing D-pad category rail. */
internal class CinemaCategoryChipAdapter(
    private val onClick: (CategoryEntity) -> Unit
) : RecyclerView.Adapter<CinemaCategoryChipAdapter.Holder>() {
    private var items = emptyList<CategoryEntity>()
    private var selectedId: String? = null

    init { setHasStableIds(true) }

    fun submit(values: List<CategoryEntity>, selected: String?) {
        items = values.toList()
        selectedId = selected
        notifyDataSetChanged()
    }

    fun select(selected: String?) {
        if (selectedId == selected) return
        selectedId = selected
        notifyDataSetChanged()
    }

    override fun getItemCount() = items.size
    override fun getItemId(position: Int) = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val label = TextView(parent.context).apply {
            gravity = Gravity.CENTER
            textSize = 13f
            maxLines = 1
            isSingleLine = true
            ellipsize = android.text.TextUtils.TruncateAt.END
            typeface = BlofyTvDesign.MediumTypeface
            setPadding(dp(17), 0, dp(17), 0)
            isClickable = true
            isFocusable = true
            minWidth = dp(70)
        }
        label.layoutParams = RecyclerView.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(42)
        ).apply {
            marginEnd = dp(8)
            topMargin = dp(2)
            bottomMargin = dp(2)
        }
        return Holder(label)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        val active = item.remoteId == (selectedId ?: "__all__")
        val label = holder.label
        label.text = item.name.trim().ifBlank { "الكل" }.take(32)
        label.contentDescription = label.text.toString() + if (active) "، محدد" else ""
        label.setTextColor(if (active) CinemaStyle.White else BlofyTvDesign.TextSecondary)
        label.background = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            if (active) intArrayOf(0xFF8F4AE3.toInt(), 0xFF6931AA.toInt())
            else intArrayOf(0xFF2D1B3E.toInt(), 0xFF171022.toInt())
        ).apply {
            cornerRadius = 22 * label.resources.displayMetrics.density
            setStroke(
                (label.resources.displayMetrics.density).toInt().coerceAtLeast(1),
                if (active) 0xFFBD83FC.toInt() else 0xFF553769.toInt()
            )
        }
        label.setOnClickListener { onClick(item) }
    }

    class Holder(val label: TextView) : RecyclerView.ViewHolder(label)
}
