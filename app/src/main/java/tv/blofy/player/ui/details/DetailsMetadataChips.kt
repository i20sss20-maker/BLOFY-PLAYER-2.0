package tv.blofy.player.ui.details

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentScreenStyle

/** Read-only metadata badges. Keeps mixed Arabic/Latin values isolated for stable bidi rendering. */
internal object DetailsMetadataChips {
    fun build(context: Context, values: List<String>): HorizontalScrollView {
        val scroll = HorizontalScrollView(context).apply {
            tag = "blofy_details_stats"
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isFocusable = false
            clipToPadding = false
            layoutDirection = context.resources.configuration.layoutDirection
        }
        scroll.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            layoutDirection = context.resources.configuration.layoutDirection
        }, android.widget.FrameLayout.LayoutParams(
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        update(scroll, values)
        return scroll
    }

    fun update(host: HorizontalScrollView, values: List<String>) {
        val row = host.getChildAt(0) as? LinearLayout ?: return
        row.removeAllViews()
        values.asSequence()
            .map(String::trim)
            .filter(String::isNotBlank)
            .distinct()
            .take(12)
            .forEach { value ->
                row.addView(TextView(host.context).apply {
                    text = value
                    textSize = 12f
                    typeface = BlofyTvDesign.MediumTypeface
                    setTextColor(BlofyTvDesign.PurpleSoft)
                    gravity = Gravity.CENTER
                    textDirection = View.TEXT_DIRECTION_LOCALE
                    includeFontPadding = false
                    background = ContentScreenStyle.chip(host.context)
                    setPadding(dp(host.context, 11), dp(host.context, 6), dp(host.context, 11), dp(host.context, 6))
                }, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    marginEnd = dp(host.context, 6)
                })
            }
    }

    private fun dp(context: Context, value: Int) =
        (value * context.resources.displayMetrics.density).toInt()
}
