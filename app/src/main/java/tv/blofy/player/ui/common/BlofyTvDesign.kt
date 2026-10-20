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
    val BackgroundRaised = Color.rgb(16, 13, 16)
    val Surface = CinemaStyle.Surface
    val SurfaceRaised = Color.rgb(52, 35, 38)
    val SurfaceFocused = Color.rgb(106, 62, 70)
    val FocusStroke = Color.rgb(255, 244, 213)
    val FocusGlow = Color.rgb(214, 181, 110)

    val Purple = Color.rgb(185, 145, 82)
    val PurpleBright = CinemaStyle.Accent
    val PurpleDeep = Color.rgb(126, 78, 52)
    val PurpleSoft = Color.rgb(255, 232, 180)
    val Lavender = Color.rgb(255, 232, 180)
    val Mint = Color.rgb(227, 192, 123)
    val Error = Color.rgb(232, 125, 130)

    val TextPrimary = CinemaStyle.White
    val TextSecondary = Color.rgb(236, 229, 220)
    val TextMuted = CinemaStyle.Muted
    val Divider = 0x4A5E4743

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
    const val CardRadius = 10
    const val PanelRadius = 14
    const val ButtonRadius = 8
    const val BadgeRadius = 10
    const val StandardGap = 18
    const val FocusInMs = 95L
    const val FocusOutMs = 75L
    const val SectionTransitionMs = 135L

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
        setStroke(if (focused) 2 else 1, if (focused) FocusStroke else Divider)
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
        setStroke(if (focused) 2 else 1, if (focused) FocusStroke else Divider)
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
            intArrayOf(0xFFF7DFA6.toInt(), 0xFFD6A85E.toInt(), 0xFFA97645.toInt())
        } else {
            intArrayOf(0xFFD09A52.toInt(), 0xFFA97645.toInt(), 0xFF6A3E46.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFFFF4D6.toInt() else 0xFF8A6A55.toInt())
    }

    fun secondaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) =
        glassSurface(radius, focused)

    fun badge(radius: Float = BadgeRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xE01D1921.toInt(), 0xE0121016.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0xFF4B424F.toInt())
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
        scale: Float = 1.024f,
        primary: Boolean = false,
        onFocused: (() -> Unit)? = null
    ) {
        installTvFocusInternal(v, radius, scale, primary) { focused -> if (focused) onFocused?.invoke() }
    }

    fun installTvFocusState(
        v: View,
        radius: Float = CardRadius.toFloat(),
        scale: Float = 1.024f,
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
        v.stateListAnimator = null
        val normal = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        val focused = if (primary) primaryButton(radius, true) else secondaryButton(radius, true)
        v.background = normal
        (v as? TextView)?.setTextColor(TextPrimary)

        v.setOnFocusChangeListener { view, hasFocus ->
            view.animate().cancel()
            view.background = if (hasFocus) focused else normal
            (view as? TextView)?.setTextColor(TextPrimary)
            val targetScale = if (hasFocus) TvUiTuning.focusScale(view.context, minOf(scale, 1.028f)) else 1f
            val duration = TvUiTuning.focusDuration(view.context, hasFocus)
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (hasFocus) TvUiTuning.focusElevation(view.context, 8f) else 0f)
                .alpha(1f)
                .setDuration(duration)
                .start()
            onFocusChanged?.invoke(hasFocus)
        }
    }
}
