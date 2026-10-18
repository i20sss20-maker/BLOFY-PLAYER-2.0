package tv.blofy.player.ui.series

import android.content.res.ColorStateList
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.ui.common.BlofyTvDesign

/** Mobile episode cards. Android TV retains the remote-tested FocusTextAdapter. */
internal class CinematicEpisodeAdapter(
    private val onClick: (EpisodeEntity) -> Unit
) : RecyclerView.Adapter<CinematicEpisodeAdapter.Holder>() {
    private var episodes = emptyList<EpisodeEntity>()
    private var progress = emptyMap<String, Int>()

    init { setHasStableIds(true) }

    fun submit(items: List<EpisodeEntity>, watch: Map<String, Int>) {
        episodes = items.toList()
        progress = watch.toMap()
        notifyDataSetChanged()
    }

    override fun getItemId(position: Int): Long = episodes[position].key.hashCode().toLong()
    override fun getItemCount() = episodes.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val row = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(17), dp(13), dp(17), dp(14))
            background = BlofyTvDesign.glassPanel(dp(19).toFloat())
            layoutParams = RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
            isClickable = true
            isFocusable = true
        }
        val top = LinearLayout(parent.context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val badge = TextView(parent.context).apply {
            gravity = Gravity.CENTER
            setTextColor(BlofyTvDesign.PurpleSoft)
            typeface = BlofyTvDesign.HeadingTypeface
            textSize = 18f
            background = BlofyTvDesign.badge(dp(14).toFloat(), accent = true)
        }
        top.addView(badge, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginEnd = dp(12) })
        val captions = LinearLayout(parent.context).apply { orientation = LinearLayout.VERTICAL }
        val heading = TextView(parent.context).apply {
            textSize = 16f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            maxLines = 2
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }
        val subtitle = TextView(parent.context).apply {
            textSize = 12f
            setTextColor(BlofyTvDesign.PurpleSoft)
            gravity = Gravity.RIGHT
            setPadding(0, dp(5), 0, 0)
        }
        captions.addView(heading)
        captions.addView(subtitle)
        top.addView(captions, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(top)
        val bar = ProgressBar(parent.context, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = ColorStateList.valueOf(BlofyTvDesign.PurpleBright)
            progressBackgroundTintList = ColorStateList.valueOf(BlofyTvDesign.SurfaceRaised)
            visibility = View.GONE
        }
        row.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(5)).apply {
            topMargin = dp(12)
        })
        row.setOnFocusChangeListener { view, focused ->
            view.background = BlofyTvDesign.glassPanel(dp(19).toFloat(), focused)
        }
        return Holder(row, badge, heading, subtitle, bar)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = episodes[position]
        val watched = progress[item.key] ?: 0
        holder.badge.text = item.episode.toString()
        holder.heading.text = item.title.ifBlank { "الحلقة ${item.episode}" }
        holder.subtitle.text = buildList {
            add("الموسم ${item.season}  •  الحلقة ${item.episode}")
            item.durationSecs?.takeIf { it > 60 }?.let { add("${it / 60} دقيقة") }
            if (watched >= 100) add("✓ تمت المشاهدة")
            else if (watched > 0) add("متابعة $watched%")
        }.joinToString("  •  ")
        holder.progress.visibility = if (watched in 1..99) View.VISIBLE else View.GONE
        holder.progress.progress = watched
        holder.itemView.contentDescription = "الحلقة ${item.episode}، ${item.title}، " +
            if (watched >= 100) "تمت المشاهدة" else if (watched > 0) "شاهدت $watched بالمئة" else "لم تشاهد بعد"
        holder.itemView.setOnClickListener { onClick(item) }
    }

    class Holder(
        view: View,
        val badge: TextView,
        val heading: TextView,
        val subtitle: TextView,
        val progress: ProgressBar
    ) : RecyclerView.ViewHolder(view)
}
