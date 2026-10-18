package tv.blofy.player.ui.details

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

/** Original BLOFY presentation of provider metadata, not third-party rating estimates. */
internal object CinematicDetailExtras {
    fun relatedItems(item: StreamEntity, recent: List<StreamEntity>): List<StreamEntity> {
        val tags = genreTokens(item.genre)
        if (tags.isEmpty()) return emptyList()
        return recent.asSequence()
            .filter { it.key != item.key && !it.locked && it.kind == item.kind }
            .filter { genreTokens(it.genre).any(tags::contains) }
            .distinctBy { it.key }
            .take(12)
            .toList()
    }

    fun addRelatedRail(
        context: Context,
        container: LinearLayout,
        related: List<StreamEntity>,
        onSelected: (StreamEntity) -> Unit
    ) {
        if (related.isEmpty()) return
        fun dp(n: Int) = (n * context.resources.displayMetrics.density).toInt()
        container.addView(TextView(context).apply {
            text = "قد يعجبك أيضًا"
            textSize = 21f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)).apply {
            topMargin = dp(13)
        })
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        related.forEach { item ->
            val card = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                background = BlofyTvDesign.posterCard(dp(14).toFloat())
                clipToOutline = true
                isFocusable = true
                isClickable = true
                contentDescription = item.name
                setOnClickListener { onSelected(item) }
            }
            card.addView(ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(BlofyTvDesign.Surface)
                ArtworkLoader.load(this, item.icon)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(166)))
            card.addView(TextView(context).apply {
                text = item.name
                textSize = 12f
                setTextColor(BlofyTvDesign.TextPrimary)
                maxLines = 2
                gravity = Gravity.CENTER
                setPadding(dp(5), dp(2), dp(5), dp(2))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
            row.addView(card, LinearLayout.LayoutParams(dp(118), dp(212)).apply { marginEnd = dp(9) })
        }
        container.addView(HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(row)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(222)))
    }

    private fun genreTokens(raw: String?): Set<String> = raw
        ?.lowercase()
        ?.split(',', '/', '|', '،', '&')
        ?.map { it.trim() }
        ?.filter { it.length >= 3 }
        ?.toSet()
        .orEmpty()
}
