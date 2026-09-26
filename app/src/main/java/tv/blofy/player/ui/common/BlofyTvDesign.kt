package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** Unified BLOFY visual language used across TV, tablet and phone surfaces. */
object BlofyTvDesign {
    val Background = Color.rgb(6, 4, 11)
    val BackgroundRaised = Color.rgb(11, 7, 18)
    val Surface = Color.rgb(20, 13, 31)
    val SurfaceRaised = Color.rgb(30, 19, 46)
    val SurfaceFocused = Color.rgb(67, 36, 99)

    val Purple = Color.rgb(143, 68, 255)
    val PurpleBright = Color.rgb(189, 119, 255)
    val PurpleDeep = Color.rgb(91, 38, 181)
    val PurpleSoft = Color.rgb(226, 204, 255)
    val PurpleMuted = Color.rgb(184, 145, 225)
    val PinkAccent = Color.rgb(231, 91, 203)
    val Mint = Color.rgb(108, 235, 204)
    val Amber = Color.rgb(255, 191, 105)
    val Danger = Color.rgb(255, 135, 155)

    val TextPrimary = Color.WHITE
    val TextSecondary = Color.rgb(234, 227, 241)
    val TextMuted = Color.rgb(176, 166, 190)
    val TextDim = Color.rgb(134, 124, 149)
    val Divider = Color.rgb(72, 51, 91)
    val FocusStroke = Color.rgb(239, 219, 255)

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
        if (focused) intArrayOf(0xFF58377A.toInt(), 0xFF2B193C.toInt())
        else intArrayOf(0xF21C1428.toInt(), 0xF20B0811.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) FocusStroke else 0x80594070.toInt())
    }

    fun elevatedSurface(radius: Float = 26f, emphasis: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (emphasis) intArrayOf(0xF23A2250.toInt(), 0xF1120B1A.toInt())
        else intArrayOf(0xF22A1B3B.toInt(), 0xF10F0A17.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (emphasis) 0xB07950A0.toInt() else 0x8A604678.toInt())
    }

    fun glassPanel(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xEE4E2B70.toInt(), 0xF020112F.toInt())
        else intArrayOf(0xE61B1228.toInt(), 0xF20B0812.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleBright else 0x80533B68.toInt())
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFB86BFF.toInt(), 0xFFE05ACA.toInt())
        else intArrayOf(0xFF8F44FF.toInt(), 0xFF6A2BD0.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) Color.WHITE else 0xB58B59B6.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF69478B.toInt(), 0xFF3B2451.toInt())
        else intArrayOf(0xEE21172E.toInt(), 0xEE100B18.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleSoft else 0x8057406A.toInt())
    }

    fun inputField(radius: Float = 18f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF1D132A.toInt(), 0xFF130D1C.toInt())
        else intArrayOf(0xEE100B18.toInt(), 0xEE0B0810.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleBright else 0x80504061.toInt())
    }

    fun posterCard(radius: Float = 22f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF6336A0.toInt(), 0xFF2B163B.toInt())
        else intArrayOf(0xEE1A1324.toInt(), 0xF10B0910.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) FocusStroke else 0x66513C65.toInt())
    }

    fun badge(radius: Float = 14f, accent: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (accent) intArrayOf(0xC13D205A.toInt(), 0xB828183A.toInt())
        else intArrayOf(0xAD20152F.toInt(), 0xAD160F20.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (accent) 0xB57F58A3.toInt() else 0x916D4C8A.toInt())
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
