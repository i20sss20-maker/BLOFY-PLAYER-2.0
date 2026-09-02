package tv.blofy.player.ui.browser

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

internal class LiveChannelAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity) -> Unit,
    private val onLongClick: (StreamEntity) -> Unit,
    private val itemKey: (StreamEntity) -> String
) : RecyclerView.Adapter<LiveChannelAdapter.Holder>() {
    private val items = ArrayList<StreamEntity>(256)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var focusedKey: String? = null

    init { setHasStableIds(true) }

    fun submit(newItems: List<StreamEntity>) = replace(newItems)
    fun replace(newItems: List<StreamEntity>) { items.clear(); items.addAll(newItems); notifyDataSetChanged() }
    fun append(newItems: List<StreamEntity>) { if (newItems.isEmpty()) return; val start = items.size; items.addAll(newItems); notifyItemRangeInserted(start, newItems.size) }
    fun indexOfKey(key: String?): Int = if (key.isNullOrBlank()) -1 else items.indexOfFirst { itemKey(it) == key }
    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)
    override fun getItemId(position: Int) = itemKey(items[position]).hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        fun dp(v: Int) = TvUiTuning.dp(context, v)
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(7), dp(14), dp(7))
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            isLongClickable = true
            background = rowBackground(false)
        }
        row.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(82)).apply {
            bottomMargin = dp(7)
            marginStart = dp(2)
            marginEnd = dp(2)
        }
        val logo = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xFF120D1A.toInt())
                setStroke(dp(1), 0xFF4A365F.toInt())
            }
        }
        row.addView(logo, LinearLayout.LayoutParams(dp(60), dp(60)).apply { marginStart = dp(13) })

        val textBox = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        val title = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 15.5f); typeface = BlofyTvDesign.LabelTypeface; setTextColor(BlofyTvDesign.TextPrimary); maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.RIGHT
        }
        val meta = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 11.5f); typeface = BlofyTvDesign.MediumTypeface; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.RIGHT
        }
        val progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000; progress = 0; visibility = View.INVISIBLE
            progressTintList = android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0xFF31233E.toInt())
        }
        textBox.addView(title, LinearLayout.LayoutParams(-1, 0, 1f))
        textBox.addView(meta, LinearLayout.LayoutParams(-1, dp(21)))
        textBox.addView(progress, LinearLayout.LayoutParams(-1, dp(4)).apply { topMargin = dp(2) })
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(64), 1f))

        val badge = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 10f); typeface = BlofyTvDesign.LabelTypeface; setTextColor(BlofyTvDesign.PurpleSoft); gravity = Gravity.CENTER
            background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(0x66382252); setStroke(dp(1), 0x995F3D82.toInt()) }
        }
        row.addView(badge, LinearLayout.LayoutParams(dp(58), dp(32)))
        return Holder(row, logo, title, meta, badge, progress)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.epgJob?.cancel()
        holder.title.text = (if (item.locked) "🔒  " else "") + item.name
        holder.meta.text = if (item.archiveEnabled) "مباشر  •  أرشيف متاح" else "مباشر الآن"
        holder.badge.text = if (item.archiveEnabled) "CATCHUP" else "LIVE"
        holder.progress.visibility = View.INVISIBLE
        val art = item.icon ?: item.backdrop
        if (!art.isNullOrBlank()) ArtworkLoader.load(holder.logo, art) else { ArtworkLoader.cancel(holder.logo); holder.logo.setImageResource(R.drawable.blofy_logo) }
        loadLocalEpg(holder, item, retryAfterFocus = false)
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnLongClickListener { onLongClick(item); true }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            if (focused) focusedKey = itemKey(item)
            view.background = rowBackground(focused)
            holder.title.setTextColor(Color.WHITE)
            holder.meta.setTextColor(if (focused) 0xFFE8D8FA.toInt() else BlofyTvDesign.TextMuted)
            holder.badge.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.PurpleSoft)
            view.animate().cancel()
            view.animate()
                .scaleX(if (focused) 1.012f else 1f)
                .scaleY(if (focused) 1.012f else 1f)
                .translationZ(if (focused) 13f else 1f)
                .setDuration(if (focused) 70L else 58L)
                .start()
            if (focused) {
                onFocus(item)
                loadLocalEpg(holder, item, retryAfterFocus = true)
            }
        }
    }

    private fun loadLocalEpg(holder: Holder, item: StreamEntity, retryAfterFocus: Boolean) {
        holder.epgJob?.cancel()
        holder.epgJob = scope.launch {
            if (retryAfterFocus) delay(700L)
            val now = System.currentTimeMillis()
            val current = withContext(Dispatchers.IO) {
                BlofyDatabase.get(holder.itemView.context.applicationContext).dao()
                    .epg(item.providerId, item.remoteId, now, 2).first()
                    .firstOrNull { it.startMs <= now && it.endMs > now }
            }
            if (holder.bindingAdapterPosition == RecyclerView.NO_POSITION || itemKey(item) != itemKey(items.getOrNull(holder.bindingAdapterPosition) ?: return@launch)) return@launch
            if (current != null) {
                val span = (current.endMs - current.startMs).coerceAtLeast(1L)
                val pct = (((now - current.startMs).coerceIn(0L, span) * 1000L) / span).toInt()
                holder.meta.text = current.title
                holder.progress.progress = pct
                holder.progress.visibility = View.VISIBLE
            } else {
                holder.progress.visibility = View.INVISIBLE
            }
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.epgJob?.cancel(); ArtworkLoader.cancel(holder.logo); holder.logo.setImageDrawable(null); super.onViewRecycled(holder)
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) { scope.cancel(); super.onDetachedFromRecyclerView(recyclerView) }
    override fun getItemCount() = items.size

    internal class Holder(
        item: View,
        val logo: ImageView,
        val title: TextView,
        val meta: TextView,
        val badge: TextView,
        val progress: ProgressBar,
        var epgJob: Job? = null
    ) : RecyclerView.ViewHolder(item)

    private fun rowBackground(focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7542C7.toInt(), 0xFF42275F.toInt()) else intArrayOf(0xE6251A35.toInt(), 0xEB18111F.toInt())
    ).apply {
        cornerRadius = 16f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF433253.toInt())
    }
}
