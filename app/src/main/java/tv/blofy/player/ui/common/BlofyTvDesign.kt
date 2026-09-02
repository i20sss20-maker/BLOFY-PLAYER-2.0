package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** Shared BLOFY TV visual language for all TV-first screens. */
object BlofyTvDesign {
    val Background = Color.rgb(7, 5, 12)
    val BackgroundRaised = Color.rgb(12, 9, 19)
    val Surface = Color.rgb(19, 14, 28)
    val SurfaceRaised = Color.rgb(28, 20, 41)
    val SurfaceFocused = Color.rgb(54, 34, 79)
    val Purple = Color.rgb(139, 55, 255)
    val PurpleBright = Color.rgb(176, 103, 255)
    val PurpleDeep = Color.rgb(91, 38, 181)
    val PurpleSoft = Color.rgb(220, 194, 255)
    val Mint = Color.rgb(113, 235, 210)
    val TextPrimary = Color.WHITE
    val TextSecondary = Color.rgb(228, 221, 236)
    val TextMuted = Color.rgb(166, 157, 179)
    val Divider = Color.rgb(63, 48, 78)

    // Compact TV typography tuned for 1080p/4K living-room viewing.
    // Keep hierarchy clear without letting labels/categories dominate the artwork.
    const val HeroTitleSp = 39f
    const val TitleSp = 30f
    const val HeadingSp = 20f
    const val BodySp = 15f
    const val LabelSp = 14f
    const val CaptionSp = 12f

    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF4C2D70.toInt(), 0xFF251633.toInt())
        else intArrayOf(0xF21A1326.toInt(), 0xF20C0913.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) 0xFFF0DEFF.toInt() else 0x80503B63.toInt())
    }

    fun elevatedSurface(radius: Float = 26f): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF22B1E3B.toInt(), 0xF1110C19.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0x8A5D4273.toInt())
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFB56DFF.toInt(), 0xFF8139E4.toInt())
        else intArrayOf(0xFF8B37FF.toInt(), 0xFF5C24B7.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0x9A684092.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF68448A.toInt(), 0xFF38234E.toInt())
        else intArrayOf(0xEE21172E.toInt(), 0xEE100C18.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else 0x80554068.toInt())
    }

    fun badge(radius: Float = 14f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(0xAD20152F.toInt())
        setStroke(1, 0x916D4C8A.toInt())
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
        setLineSpacing(0f, 1.12f)
    }

    fun applyLabel(text: TextView) = text.apply {
        textSize = LabelSp
        typeface = BodyTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyCaption(text: TextView) = text.apply {
        textSize = CaptionSp
        typeface = BodyTypeface
        setTextColor(TextMuted)
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
                .translationZ(if (focused) 22f else 2f)
                .alpha(if (focused) 1f else 0.95f)
                .setDuration(if (focused) 105L else 85L)
                .start()
            if (focused) onFocused?.invoke()
        }
    }
}
