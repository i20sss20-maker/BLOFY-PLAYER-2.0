package tv.blofy.player.ui.details

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

internal object SimilarStrip {
    fun build(context: Context, items: List<StreamEntity>, onClick: (StreamEntity) -> Unit): View {
        fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()
        val scroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(4), 0, dp(4))
            clipChildren = false
        }
        items.take(12).forEach { item ->
            val card = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                isFocusable = true
                isFocusableInTouchMode = true
                isClickable = true
                setPadding(dp(5), dp(5), dp(5), dp(7))
                background = cardBackground(false, dp(14))
                setOnClickListener { onClick(item) }
                setOnFocusChangeListener { view, focused ->
                    view.background = cardBackground(focused, dp(14))
                    view.animate().cancel()
                    view.animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f)
                        .translationZ(if (focused) dp(8).toFloat() else 1f).setDuration(65).start()
                }
            }
            val image = ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(0xFF181020.toInt())
                clipToOutline = true
            }
            card.addView(image, LinearLayout.LayoutParams(dp(106), dp(154)))
            ArtworkLoader.load(image, item.icon ?: item.backdrop)
            card.addView(TextView(context).apply {
                text = item.name
                textSize = 11.8f
                typeface = BlofyTvDesign.LabelTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(dp(118), dp(40)))
            card.addView(TextView(context).apply {
                text = buildList {
                    item.year?.takeIf(String::isNotBlank)?.let(::add)
                    item.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                }.joinToString(" • ")
                textSize = 10f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.CENTER
                maxLines = 1
            }, LinearLayout.LayoutParams(dp(118), dp(20)))
            row.addView(card, LinearLayout.LayoutParams(dp(128), dp(226)).apply { marginStart = dp(7); marginEnd = dp(3) })
        }
        scroll.addView(row)
        return scroll
    }

    fun match(recommendedTitles: List<String>, local: List<StreamEntity>, kind: String): List<StreamEntity> {
        if (recommendedTitles.isEmpty()) return emptyList()
        val candidates = local.filter { it.kind == kind }
        val normalized = candidates.associateBy { normalize(it.name) }
        val result = ArrayList<StreamEntity>(12)
        recommendedTitles.forEach { title ->
            val key = normalize(title)
            val exact = normalized[key]
            val fuzzy = exact ?: candidates.firstOrNull { candidate ->
                val c = normalize(candidate.name)
                key.length >= 4 && (c.contains(key) || key.contains(c))
            }
            if (fuzzy != null && result.none { it.key == fuzzy.key }) result += fuzzy
            if (result.size >= 12) return@forEach
        }
        return result
    }

    private fun normalize(value: String): String = value
        .lowercase()
        .replace(Regex("(?i)\\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|arabic|مترجم|مدبلج)\\b"), " ")
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .trim()
        .replace(Regex("\\s+"), " ")

    private fun cardBackground(focused: Boolean, radius: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF563179.toInt(), 0xFF24162E.toInt()) else intArrayOf(0xD91D1527.toInt(), 0xE6130E1B.toInt())
    ).apply {
        cornerRadius = radius.toFloat()
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF3A2A48.toInt())
    }
}
