package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** Unified BLOFY visual language used across TV, tablet and phone surfaces. */
object BlofyTvDesign {
    // Cinema Luxe palette: black graphite, warm champagne and restrained burgundy.
    val Background = Color.rgb(8, 8, 11)
    val BackgroundRaised = Color.rgb(16, 13, 16)
    val Surface = Color.rgb(26, 21, 24)
    val SurfaceRaised = Color.rgb(36, 27, 31)
    val SurfaceFocused = Color.rgb(86, 43, 53)

    val Purple = Color.rgb(185, 145, 82)
    val PurpleBright = Color.rgb(242, 210, 139)
    val PurpleDeep = Color.rgb(126, 78, 52)
    val PurpleSoft = Color.rgb(255, 232, 180)
    val PurpleMuted = Color.rgb(204, 172, 119)
    val PinkAccent = Color.rgb(141, 48, 70)
    val Mint = Color.rgb(227, 192, 123)
    val Amber = Color.rgb(242, 210, 139)
    val Danger = Color.rgb(232, 125, 130)

    val TextPrimary = Color.WHITE
    val TextSecondary = Color.rgb(236, 229, 220)
    val TextMuted = Color.rgb(184, 169, 158)
    val TextDim = Color.rgb(143, 128, 121)
    val Divider = Color.rgb(83, 61, 61)
    val FocusStroke = Color.rgb(255, 232, 180)

    const val HeroTitleSp = 40f
    const val TitleSp = 31f
    const val HeadingSp = 21f
    const val BodySp = 15.5f
    const val LabelSp = 14f
    const val CaptionSp = 12f

    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF6D3945.toInt(), 0xFF342024.toInt())
        else intArrayOf(0xF2262022.toInt(), 0xF20C0B0C.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) FocusStroke else 0x80594070.toInt())
    }

    fun elevatedSurface(radius: Float = 26f, emphasis: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (emphasis) intArrayOf(0xF23A2250.toInt(), 0xF1120B1A.toInt())
        else intArrayOf(0xF22D2325.toInt(), 0xF10F0D0F.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (emphasis) 0xB07950A0.toInt() else 0x8A604678.toInt())
    }

    fun glassPanel(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xEE68404A.toInt(), 0xF0211518.toInt())
        else intArrayOf(0xE6211B1D.toInt(), 0xF20C0B0D.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleBright else 0x805E4743.toInt())
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFF2D28B.toInt(), 0xFFC88D54.toInt())
        else intArrayOf(0xFFC9A562.toInt(), 0xFF8C523F.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0xB5A47B55.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF70424B.toInt(), 0xFF3F252B.toInt())
        else intArrayOf(0xEE261D20.toInt(), 0xEE100D0F.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else 0x805E4545.toInt())
    }

    fun inputField(radius: Float = 18f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF271E20.toInt(), 0xFF140F11.toInt())
        else intArrayOf(0xEE120E10.toInt(), 0xEE0B0A0B.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleBright else 0x805A4440.toInt())
    }

    fun posterCard(radius: Float = 22f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF70414C.toInt(), 0xFF321C24.toInt())
        else intArrayOf(0xEE241B1F.toInt(), 0xF10B0A0D.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) FocusStroke else 0x665F4645.toInt())
    }

    fun badge(radius: Float = 14f, accent: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (accent) intArrayOf(0xC17A4A3D.toInt(), 0xB83C2427.toInt())
        else intArrayOf(0xAD2A2020.toInt(), 0xAD171012.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (accent) 0xB5C19A5B.toInt() else 0x916C514A.toInt())
    }

    fun statusPill(radius: Float = 14f, success: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (success) intArrayOf(0x65326B5B, 0x45223F39)
        else intArrayOf(0xA2261936.toInt(), 0xA216101F.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (success) 0x996CEBCC.toInt() else 0x996E4C86.toInt())
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
        view.stateListAnimator = null
        view.background = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (primary) primaryButton(radius, focused) else secondaryButton(radius, focused)
            v.animate().cancel()
            v.animate()
                .scaleX(if (focused) scale else 1f)
                .scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 24f else 2f)
                .alpha(if (focused) 1f else 0.96f)
                .setDuration(if (focused) 115L else 90L)
                .start()
            if (focused) onFocused?.invoke()
        }
    }
}
