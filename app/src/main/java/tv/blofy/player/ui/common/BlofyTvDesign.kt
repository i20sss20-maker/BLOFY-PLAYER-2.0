package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/**
 * BLOFY's shared visual language. Keep screens visually consistent by defining premium dark-TV
 * surfaces, typography and DPAD focus here instead of styling every screen independently.
 */
object BlofyTvDesign {
    val Background = CinemaStyle.Background
    val BackgroundRaised = Color.rgb(31, 17, 51)
    val Surface = CinemaStyle.Surface
    val SurfaceRaised = Color.rgb(54, 33, 79)
    val SurfaceFocused = Color.rgb(95, 57, 140)

    val Purple = Color.rgb(127, 73, 209)
    val PurpleBright = CinemaStyle.Accent
    val PurpleDeep = Color.rgb(53, 28, 80)
    val PurpleSoft = Color.rgb(210, 187, 238)
    val Lavender = Color.rgb(232, 220, 246)
    val Mint = Color.rgb(91, 220, 187)
    val Error = Color.rgb(255, 118, 140)

    val TextPrimary = CinemaStyle.White
    val TextSecondary = Color.rgb(218, 213, 225)
    val TextMuted = CinemaStyle.Muted
    val Divider = 0x45FFFFFF

    const val HeroTitleSp = 42f
    const val DetailTitleSp = 40f
    const val TitleSp = 31f
    const val HeadingSp = 20f
    const val BodySp = 15f
    const val LabelSp = 14.5f
    const val CaptionSp = 12f

    const val ScreenPadding = 30
    const val PanelPadding = 18
    const val RailWidth = 250
    const val CategoryRowHeight = 60
    const val LiveListWidth = 455
    const val CardRadius = 8
    const val PanelRadius = 10
    const val ButtonRadius = 6
    const val BadgeRadius = 10
    const val StandardGap = 18
    const val FocusInMs = 80L
    const val FocusOutMs = 65L
    const val SectionTransitionMs = 120L

    val DisplayTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val LabelTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.NORMAL) }
    val MediumTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = CardRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(SurfaceFocused, SurfaceRaised, Surface)
        } else {
            intArrayOf(Surface, Surface, BackgroundRaised)
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) TextPrimary else Divider)
    }

    fun glassSurface(radius: Float = CardRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(SurfaceFocused, SurfaceRaised, Surface)
        } else {
            intArrayOf(Surface, Surface, BackgroundRaised)
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) TextPrimary else Divider)
    }

    fun elevatedSurface(radius: Float = PanelRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(SurfaceRaised, Surface, BackgroundRaised)
    ).apply {
        cornerRadius = radius
        setStroke(1, Divider)
    }

    fun primaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) {
            intArrayOf(0xFFB979F4.toInt(), 0xFF8750D7.toInt(), 0xFF6232AA.toInt())
        } else {
            intArrayOf(0xFF874CD5.toInt(), 0xFF6B36B5.toInt(), 0xFF51288F.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFF0E1FC.toInt() else 0xFF8964AE.toInt())
    }

    fun secondaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) =
        glassSurface(radius, focused)

    fun badge(radius: Float = BadgeRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xD421182D.toInt(), 0xD617121E.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0xFF584768.toInt())
    }

    fun applyTitle(t: TextView) = t.apply {
        textSize = TitleSp
        typeface = DisplayTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.008f
    }

    fun applyHeroTitle(t: TextView) = t.apply {
        textSize = HeroTitleSp
        typeface = DisplayTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.015f
    }

    fun applyHeading(t: TextView) = t.apply {
        textSize = HeadingSp
        typeface = HeadingTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.004f
    }

    fun applyBody(t: TextView) = t.apply {
        textSize = BodySp
        typeface = BodyTypeface
        setTextColor(TextSecondary)
        includeFontPadding = false
        setLineSpacing(0f, 1.18f)
    }

    fun applyLabel(t: TextView) = t.apply {
        textSize = LabelSp
        typeface = LabelTypeface
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyCaption(t: TextView) = t.apply {
        textSize = CaptionSp
        typeface = MediumTypeface
        setTextColor(TextMuted)
        includeFontPadding = false
    }

    fun installTvFocus(
        v: View,
        radius: Float = CardRadius.toFloat(),
        scale: Float = 1.018f,
        primary: Boolean = false,
        onFocused: (() -> Unit)? = null
    ) {
        installTvFocusInternal(v, radius, scale, primary) { focused -> if (focused) onFocused?.invoke() }
    }

    fun installTvFocusState(
        v: View,
        radius: Float = CardRadius.toFloat(),
        scale: Float = 1.018f,
        primary: Boolean = false,
        onFocusChanged: (Boolean) -> Unit
    ) {
        installTvFocusInternal(v, radius, scale, primary, onFocusChanged)
    }

    private fun installTvFocusInternal(
        v: View,
        radius: Float,
        scale: Float,
        primary: Boolean,
        onFocusChanged: ((Boolean) -> Unit)?
    ) {
        v.isFocusable = true
        v.isFocusableInTouchMode = true
        val normal = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        val focused = if (primary) primaryButton(radius, true) else secondaryButton(radius, true)
        v.background = normal
        (v as? TextView)?.setTextColor(TextPrimary)

        v.setOnFocusChangeListener { view, hasFocus ->
            view.animate().cancel()
            view.background = if (hasFocus) focused else normal
            (view as? TextView)?.setTextColor(TextPrimary)
            val targetScale = if (hasFocus) minOf(scale, 1.012f) else 1f
            val duration = if (hasFocus) FocusInMs else FocusOutMs
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (hasFocus) 6f else 0f)
                .alpha(1f)
                .setDuration(duration)
                .start()
            onFocusChanged?.invoke(hasFocus)
        }
    }
}
