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
    val Background = Color.rgb(8, 7, 13)
    val BackgroundRaised = Color.rgb(14, 11, 21)
    val Surface = Color.rgb(22, 17, 30)
    val SurfaceRaised = Color.rgb(29, 22, 40)
    val SurfaceFocused = Color.rgb(68, 39, 101)

    val Purple = Color.rgb(132, 76, 218)
    val PurpleBright = Color.rgb(180, 116, 255)
    val PurpleDeep = Color.rgb(58, 31, 88)
    val PurpleSoft = Color.rgb(211, 186, 240)
    val Lavender = Color.rgb(230, 216, 245)
    val Mint = Color.rgb(91, 220, 187)
    val Error = Color.rgb(255, 118, 140)

    val TextPrimary = Color.rgb(251, 249, 253)
    val TextSecondary = Color.rgb(221, 216, 228)
    val TextMuted = Color.rgb(151, 143, 163)
    val Divider = Color.rgb(49, 40, 59)

    const val HeroTitleSp = 42f
    const val DetailTitleSp = 40f
    const val TitleSp = 31f
    const val HeadingSp = 20f
    const val BodySp = 15f
    const val LabelSp = 14.5f
    const val CaptionSp = 12f

    const val ScreenPadding = 30
    const val PanelPadding = 16
    const val RailWidth = 250
    const val CategoryRowHeight = 60
    const val LiveListWidth = 455
    const val CardRadius = 22
    const val PanelRadius = 26
    const val ButtonRadius = 18
    const val BadgeRadius = 12
    const val StandardGap = 20
    const val FocusInMs = 90L
    const val FocusOutMs = 70L
    const val SectionTransitionMs = 120L

    val DisplayTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val LabelTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.NORMAL) }
    val MediumTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = CardRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(0xFF5D3987.toInt(), 0xFF2B1A3B.toInt(), 0xFF19121F.toInt())
        } else {
            intArrayOf(0xF5221B2C.toInt(), 0xF517121F.toInt(), 0xF2110E16.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFE0C1FF.toInt() else 0xFF3B3046.toInt())
    }

    fun glassSurface(radius: Float = CardRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(0xEB5A367F.toInt(), 0xED261A35.toInt(), 0xED16101E.toInt())
        } else {
            intArrayOf(0xE31D1726.toInt(), 0xE616111D.toInt(), 0xE6110D16.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFD7B2FF.toInt() else 0x6B51415F)
    }

    fun elevatedSurface(radius: Float = PanelRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF52A2137.toInt(), 0xF51C1626.toInt(), 0xF513101A.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0xFF443650.toInt())
    }

    fun primaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) {
            intArrayOf(0xFFBE7CFF.toInt(), 0xFF8A51E3.toInt(), 0xFF6230B4.toInt())
        } else {
            intArrayOf(0xFF8D50E3.toInt(), 0xFF6D35BF.toInt(), 0xFF54279C.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFF1E1FF.toInt() else 0xFF9A70C9.toInt())
    }

    fun secondaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) =
        glassSurface(radius, focused)

    fun badge(radius: Float = BadgeRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xD6261B32.toInt(), 0xD61A1422.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0xFF635078.toInt())
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
        scale: Float = 1.025f,
        primary: Boolean = false,
        onFocused: (() -> Unit)? = null
    ) {
        installTvFocusInternal(v, radius, scale, primary) { focused -> if (focused) onFocused?.invoke() }
    }

    fun installTvFocusState(
        v: View,
        radius: Float = CardRadius.toFloat(),
        scale: Float = 1.025f,
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
            val targetScale = if (hasFocus) minOf(scale, 1.016f) else 1f
            val duration = if (hasFocus) FocusInMs else FocusOutMs
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (hasFocus) 8f else 0f)
                .alpha(1f)
                .setDuration(duration)
                .start()
            onFocusChanged?.invoke(hasFocus)
        }
    }
}
