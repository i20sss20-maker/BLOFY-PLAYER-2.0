package tv.blofy.player.ui.series

import tv.blofy.player.ui.common.ContentPresentation

import tv.blofy.player.ui.common.CinemaStyle

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.R
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentScreenStyle
import tv.blofy.player.ui.common.TvUiTuning

internal class EpisodeCardAdapter(
    private val seriesName: String?,
    private val seriesArt: String?,
    private val onClick: (EpisodeEntity) -> Unit,
    private val onFocus: (EpisodeEntity) -> Unit
) : RecyclerView.Adapter<EpisodeCardAdapter.Holder>() {
    private val items = mutableListOf<EpisodeEntity>()
    private var progress = emptyMap<String, Int>()
    private var focusedKey: String? = null
    private var attached: RecyclerView? = null

    init { setHasStableIds(true) }

    fun submit(newItems: List<EpisodeEntity>) {
        val old = items.toList()
        val previousKey = focusedKey
        val diff = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = old.size
            override fun getNewListSize() = newItems.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition].key == newItems[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition] == newItems[newItemPosition]
        }, false)
        items.clear()
        items.addAll(newItems)
        diff.dispatchUpdatesTo(this)
        if (!previousKey.isNullOrBlank() && attached?.hasFocus() == true) {
            val index = items.indexOfFirst { it.key == previousKey }
            if (index >= 0) attached?.post { requestFocusAt(index) }
        }
    }

    fun setProgress(values: Map<String, Int>) {
        progress = values.toMap()
        if (itemCount > 0) notifyItemRangeChanged(0, itemCount, "progress")
    }

    fun indexOfKey(key: String?): Int = if (key.isNullOrBlank()) -1 else items.indexOfFirst { it.key == key }

    fun requestFocusAt(position: Int): Boolean {
        if (position !in items.indices) return false
        val recycler = attached ?: return false
        focusedKey = items[position].key
        val existing = recycler.findViewHolderForAdapterPosition(position)?.itemView
        if (existing != null) return existing.requestFocus()
        recycler.scrollToPosition(position)
        recycler.post { recycler.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus() }
        return true
    }

    override fun onAttachedToRecyclerView(recyclerView: RecyclerView) {
        super.onAttachedToRecyclerView(recyclerView)
        attached = recyclerView
        recyclerView.preserveFocusAfterLayout = true
    }

    override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
        if (attached === recyclerView) attached = null
        super.onDetachedFromRecyclerView(recyclerView)
    }

    override fun getItemId(position: Int) = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        fun dp(v: Int) = TvUiTuning.dp(context, v)
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = context.resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(7), dp(10), dp(7))
            isFocusable = true
            isFocusableInTouchMode = true
            isClickable = true
            background = ContentScreenStyle.softSurface(context, false, 14)
        }
        row.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(86)).apply {
            bottomMargin = dp(5)
            marginStart = dp(2)
            marginEnd = dp(2)
        }
        val frame = FrameLayout(context)
        val image = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = ContentScreenStyle.softSurface(context, false, 12)
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(dp(124), dp(70)))
        val number = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = ContentScreenStyle.chip(context)
        }
        frame.addView(number, FrameLayout.LayoutParams(dp(40), dp(24), Gravity.BOTTOM or Gravity.END).apply { marginEnd = dp(5); bottomMargin = dp(5) })
        row.addView(frame, LinearLayout.LayoutParams(dp(124), dp(70)).apply { marginEnd = dp(13) })
        val textBox = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
        }
        val title = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 14.2f)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.START
        }
        val meta = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 12f)
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.START
        }
        val progressBar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = 0
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = ColorStateList.valueOf(0xFF3A294A.toInt())
        }
        textBox.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        textBox.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(19)))
        textBox.addView(progressBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)).apply { topMargin = dp(4) })
        row.addView(textBox, LinearLayout.LayoutParams(0, dp(70), 1f))
        val state = TextView(context).apply {
            textSize = TvUiTuning.sp(context, 12f)
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(CinemaStyle.White)
            background = ContentScreenStyle.chip(context)
            maxLines = 1
            gravity = Gravity.CENTER
        }
        row.addView(state, LinearLayout.LayoutParams(dp(100), dp(32)))
        return Holder(row, image, number, title, meta, progressBar, state)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val episode = items[position]
        val context = holder.itemView.context
        holder.number.text = context.getString(R.string.cinema_episode_badge, episode.episode)
        holder.title.text = cleanEpisodeTitle(context, episode)
        val duration = episode.durationSecs?.takeIf { it > 0 }?.let { secs -> context.getString(R.string.details_minutes, secs / 60) }
        holder.meta.text = listOfNotNull(context.getString(R.string.episodes_season, episode.season), duration).joinToString("  •  ")
        val pct = progress[episode.key] ?: 0
        holder.state.text = when {
            pct >= 100 -> context.getString(R.string.cinema_episode_completed)
            pct > 0 -> context.getString(R.string.cinema_episode_resume, pct)
            else -> context.getString(R.string.cinema_episode_play)
        }
        holder.progressBar.visibility = if (pct in 1..99) View.VISIBLE else View.GONE
        holder.progressBar.progress = pct.coerceIn(0, 100)
        if (!seriesArt.isNullOrBlank()) ArtworkLoader.load(holder.image, seriesArt) else {
            ArtworkLoader.cancel(holder.image)
            holder.image.setImageResource(R.drawable.blofy_logo)
        }
        renderFocus(holder, holder.itemView.hasFocus())
        holder.itemView.contentDescription = listOf(holder.title.text, holder.meta.text, holder.state.text).joinToString(". ")
        holder.itemView.setOnClickListener { onClick(episode) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            if (focused) focusedKey = episode.key
            renderFocus(holder, focused)
            view.animate().cancel()
            val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.008f) else 1f
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (focused) TvUiTuning.focusElevation(view.context, 10f) else 0f)
                .setDuration(TvUiTuning.focusDuration(view.context, focused))
                .start()
            if (focused) onFocus(episode)
        }
    }

    private fun cleanEpisodeTitle(context: android.content.Context, episode: EpisodeEntity): String {
        var title = ContentPresentation.title(episode.title, "episode").trim()
        val normalizedSeries = seriesName?.let { ContentPresentation.title(it, "series") }?.trim().orEmpty()
        if (normalizedSeries.isNotBlank() && title.startsWith(normalizedSeries, ignoreCase = true)) {
            title = title.removePrefix(normalizedSeries).trim()
        }
        title = title
            .replace(Regex("(?i)\\bS\\d{1,2}E\\d{1,3}\\b"), "")
            .replace(Regex("^[\\s\\-–—•:]+"), "")
            .replace(Regex("[\\s\\-–—•:]+$"), "")
            .trim()
        val genericEpisode = Regex("(?i)^(episode|ep\\.?|الحلقة)\\s*0*\\d+$")
        return if (title.isBlank() || genericEpisode.matches(title)) {
            context.getString(R.string.cinema_episode_title, episode.episode)
        } else title
    }

    override fun getItemCount() = items.size

    internal class Holder(
        item: View,
        val image: ImageView,
        val number: TextView,
        val title: TextView,
        val meta: TextView,
        val progressBar: ProgressBar,
        val state: TextView
    ) : RecyclerView.ViewHolder(item)

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = ContentScreenStyle.softSurface(holder.itemView.context, focused, 14)
        holder.title.setTextColor(CinemaStyle.White)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.Lavender else CinemaStyle.Muted)
        holder.state.background = if (focused) ContentScreenStyle.actionBackground(holder.itemView.context, true, true) else ContentScreenStyle.chip(holder.itemView.context)
        holder.state.setTextColor(if (focused) 0xFF130B1D.toInt() else CinemaStyle.White)
        holder.progressBar.progressTintList = ColorStateList.valueOf(if (focused) BlofyTvDesign.FocusGlow else BlofyTvDesign.PurpleBright)
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.image)
        holder.image.setImageDrawable(null)
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        super.onViewRecycled(holder)
    }
}
