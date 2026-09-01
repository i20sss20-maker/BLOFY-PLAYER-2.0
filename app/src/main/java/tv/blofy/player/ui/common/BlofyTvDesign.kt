package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** Shared visual language for BLOFY TV surfaces.
 * Keeps typography, focus, spacing and surfaces consistent across Live/VOD/Series/Player.
 */
object BlofyTvDesign {
    val Background = Color.rgb(9, 7, 14)
    val Surface = Color.rgb(24, 18, 34)
    val SurfaceRaised = Color.rgb(34, 25, 48)
    val Purple = Color.rgb(126, 70, 235)
    val PurpleSoft = Color.rgb(205, 178, 255)
    val TextPrimary = Color.WHITE
    val TextSecondary = Color.rgb(202, 194, 214)
    val TextMuted = Color.rgb(151, 143, 166)

    const val TitleSp = 34f
    const val HeadingSp = 25f
    const val BodySp = 18f
    const val LabelSp = 16f
    const val CaptionSp = 14f

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(if (focused) Color.rgb(56, 37, 83) else Surface)
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else Color.rgb(67, 53, 82))
    }

    fun focusedSurface(radius: Float = 24f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(Color.rgb(66, 43, 98))
        setStroke(3, PurpleSoft)
    }

    fun applyTitle(text: TextView) = text.apply {
        textSize = TitleSp
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyHeading(text: TextView) = text.apply {
        textSize = HeadingSp
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyBody(text: TextView) = text.apply {
        textSize = BodySp
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        setTextColor(TextSecondary)
        includeFontPadding = false
        setLineSpacing(0f, 1.12f)
    }

    fun applyLabel(text: TextView) = text.apply {
        textSize = LabelSp
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun installTvFocus(view: View, radius: Float = 22f, scale: Float = 1.045f, onFocused: (() -> Unit)? = null) {
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.background = surface(radius, false)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (focused) focusedSurface(radius) else surface(radius, false)
            v.animate()
                .scaleX(if (focused) scale else 1f)
                .scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 12f else 0f)
                .setDuration(140L)
                .start()
            if (focused) onFocused?.invoke()
        }
    }
}
