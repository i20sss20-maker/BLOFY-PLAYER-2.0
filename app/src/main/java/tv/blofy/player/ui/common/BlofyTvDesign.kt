package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/**
 * Unified BLOFY visual language used across TV, tablet and phone surfaces.
 *
 * The base surfaces intentionally stay near-black. Purple is reserved for
 * hierarchy, focus and primary actions so the interface feels cinematic
 * instead of looking like one large purple panel.
 */
object BlofyTvDesign {
    val Background = Color.rgb(5, 4, 10)
    val BackgroundRaised = Color.rgb(10, 8, 15)
    val Surface = Color.rgb(18, 14, 25)
    val SurfaceRaised = Color.rgb(26, 20, 36)
    val SurfaceFocused = Color.rgb(50, 34, 68)

    val Purple = Color.rgb(143, 68, 255)
    val PurpleBright = Color.rgb(196, 132, 255)
    val PurpleDeep = Color.rgb(91, 38, 181)
    val PurpleSoft = Color.rgb(230, 214, 248)
    val PurpleMuted = Color.rgb(174, 142, 205)
    val PinkAccent = Color.rgb(226, 103, 196)
    val Mint = Color.rgb(105, 225, 196)
    val Amber = Color.rgb(246, 188, 105)
    val Danger = Color.rgb(255, 132, 152)

    val TextPrimary = Color.rgb(250, 248, 252)
    val TextSecondary = Color.rgb(224, 219, 230)
    val TextMuted = Color.rgb(164, 155, 174)
    val TextDim = Color.rgb(119, 111, 130)
    val Divider = Color.rgb(58, 45, 69)
    val FocusStroke = Color.rgb(244, 231, 255)

    const val HeroTitleSp = 38f
    const val TitleSp = 30f
    const val HeadingSp = 21f
    const val BodySp = 15f
    const val LabelSp = 13.5f
    const val CaptionSp = 12f

    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF3E2A56.toInt(), 0xFF1B1325.toInt())
        else intArrayOf(0xF2181422.toInt(), 0xF20B0910.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) FocusStroke else 0x5A4A3A58)
    }

    fun elevatedSurface(radius: Float = 26f, emphasis: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (emphasis) intArrayOf(0xF02E203D.toInt(), 0xF0100C16.toInt())
        else intArrayOf(0xEE21192C.toInt(), 0xF00D0A12.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (emphasis) 0x8B755389.toInt() else 0x5C554263)
    }

    fun glassPanel(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xE83B2851.toInt(), 0xF0181121.toInt())
        else intArrayOf(0xDF17121F.toInt(), 0xEC09080E.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleBright else 0x574F3E5E)
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFB96BFF.toInt(), 0xFFD950C0.toInt())
        else intArrayOf(0xFF8F44FF.toInt(), 0xFF6C2FD0.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) Color.WHITE else 0x947B50A2.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF4A355D.toInt(), 0xFF281C35.toInt())
        else intArrayOf(0xEE1B1621.toInt(), 0xF00E0B12.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleSoft else 0x654C3E57)
    }

    fun inputField(radius: Float = 18f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF20162C.toInt(), 0xFF130E1A.toInt())
        else intArrayOf(0xF00E0B14.toInt(), 0xF008070C.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleBright else 0x65463A50)
    }

    fun posterCard(radius: Float = 22f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF51316D.toInt(), 0xFF24172F.toInt())
        else intArrayOf(0xEE17121E.toInt(), 0xF009080D.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) FocusStroke else 0x4F493A54)
    }

    fun badge(radius: Float = 14f, accent: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (accent) intArrayOf(0xA93A2450.toInt(), 0x8F24182F.toInt())
        else intArrayOf(0x951A1521.toInt(), 0x8A100D15.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (accent) 0x8C76538D.toInt() else 0x5A584360)
    }

    fun statusPill(radius: Float = 14f, success: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (success) intArrayOf(0x55305F52, 0x38203B35)
        else intArrayOf(0x8C21172B.toInt(), 0x79130F19.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (success) 0x8069D8BD.toInt() else 0x6F6B4C7D)
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
        scale: Float = 1.035f,
        primary: Boolean = false,
        onFocused: (() -> Unit)? = null
    ) {
        val density = view.resources.displayMetrics.density
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
                .translationZ((if (focused) 16f else 2f) * density)
                .alpha(if (focused) 1f else 0.97f)
                .setDuration(if (focused) 110L else 85L)
                .start()
            if (focused) onFocused?.invoke()
        }
    }
}
