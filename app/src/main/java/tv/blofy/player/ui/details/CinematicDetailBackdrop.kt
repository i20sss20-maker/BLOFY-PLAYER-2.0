package tv.blofy.player.ui.details

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

/** Brand-safe native detail banner using only the active provider's actual artwork. */
internal object CinematicDetailBackdrop {
    fun create(context: Context, item: StreamEntity, typeName: String): FrameLayout {
        fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
        val frame = FrameLayout(context).apply {
            background = BlofyTvDesign.posterCard(dp(22).toFloat())
            clipToOutline = true
            contentDescription = "$typeName: ${item.name}"
        }
        frame.addView(ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
            ArtworkLoader.load(this, listOf(item.backdrop, item.icon))
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.addView(View(context).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0x26090713, 0x13090713, 0xD7140C23.toInt(), 0xFF08060D.toInt()))
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        frame.addView(TextView(context).apply {
            text = "✦  BLOFY CINEMA  •  $typeName"
            textSize = 12f
            setTextColor(BlofyTvDesign.PurpleSoft)
            typeface = BlofyTvDesign.HeadingTypeface
            gravity = Gravity.RIGHT
            setPadding(dp(16), dp(16), dp(16), 0)
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48), Gravity.TOP))
        val line = listOfNotNull(
            item.year?.takeIf(String::isNotBlank),
            item.genre?.takeIf(String::isNotBlank)?.take(55)
        ).joinToString("  •  ")
        if (line.isNotBlank()) {
            frame.addView(TextView(context).apply {
                text = line
                textSize = 14f
                maxLines = 2
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT or Gravity.BOTTOM
                setPadding(dp(18), 0, dp(18), dp(18))
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(75), Gravity.BOTTOM))
        }
        return frame
    }
}
