package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/**
 * Shared BLOFY TV visual language.
 * Keeps typography, focus, spacing and surfaces consistent across Home/Live/VOD/Series/Player.
 */
object BlofyTvDesign {
    val Background = Color.rgb(7, 5, 12)
    val BackgroundRaised = Color.rgb(12, 9, 19)
    val Surface = Color.rgb(20, 15, 29)
    val SurfaceRaised = Color.rgb(29, 21, 42)
    val SurfaceFocused = Color.rgb(54, 34, 79)
    val Purple = Color.rgb(139, 55, 255)
    val PurpleDeep = Color.rgb(91, 38, 181)
    val PurpleSoft = Color.rgb(220, 194, 255)
    val Mint = Color.rgb(113, 235, 210)
    val TextPrimary = Color.WHITE
    val TextSecondary = Color.rgb(226, 219, 234)
    val TextMuted = Color.rgb(164, 154, 177)
    val Divider = Color.rgb(63, 48, 78)

    const val HeroTitleSp = 42f
    const val TitleSp = 34f
    const val HeadingSp = 24f
    const val BodySp = 17f
    const val LabelSp = 15.5f
    const val CaptionSp = 13.5f

    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF482B69.toInt(), 0xFF21152F.toInt())
        else intArrayOf(0xF01A1326.toInt(), 0xF00D0A14.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else Color.rgb(66, 51, 82))
    }

    fun elevatedSurface(radius: Float = 26f): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF02A1E3A.toInt(), 0xF0100C18.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, Color.rgb(78, 56, 98))
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFAF6BFF.toInt(), 0xFF7A35D9.toInt())
        else intArrayOf(0xFF8B37FF.toInt(), 0xFF5D24B8.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0x805B3484.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF5C3A7C.toInt(), 0xFF342149.toInt())
        else intArrayOf(0xEC21172E.toInt(), 0xEC100C18.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else Color.rgb(76, 57, 94))
    }

    fun badge(radius: Float = 14f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(0xA31F1530.toInt())
        setStroke(1, 0x806D4C8A.toInt())
    }

    fun applyTitle(text: TextView) = text.apply {
        textSize = TitleSp
        typeface = HeadingTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyHeroTitle(text: TextView) = text.apply {
        textSize = HeroTitleSp
        typeface = HeadingTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyHeading(text: TextView) = text.apply {
        textSize = HeadingSp
        typeface = HeadingTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyBody(text: TextView) = text.apply {
        textSize = BodySp
        typeface = BodyTypeface
        setTextColor(TextSecondary)
        includeFontPadding = false
        setLineSpacing(0f, 1.14f)
    }

    fun applyLabel(text: TextView) = text.apply {
        textSize = LabelSp
        typeface = BodyTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun installTvFocus(
        view: View,
        radius: Float = 20f,
        scale: Float = 1.04f,
        primary: Boolean = false,
        onFocused: (() -> Unit)? = null
    ) {
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.background = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (primary) primaryButton(radius, focused) else secondaryButton(radius, focused)
            v.animate().cancel()
            v.animate()
                .scaleX(if (focused) scale else 1f)
                .scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 18f else 2f)
                .alpha(if (focused) 1f else 0.96f)
                .setDuration(if (focused) 120L else 90L)
                .start()
            if (focused) onFocused?.invoke()
        }
    }
}
