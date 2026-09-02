package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** BLOFY premium Black-Plum design language. UI only; playback/network behavior is untouched. */
object BlofyTvDesign {
    // Quiet cinematic base: purple is reserved for focus/action instead of flooding every surface.
    val Background = Color.rgb(10, 8, 16)
    val BackgroundRaised = Color.rgb(17, 13, 25)
    val Surface = Color.rgb(25, 20, 34)
    val SurfaceRaised = Color.rgb(32, 25, 43)
    val SurfaceFocused = Color.rgb(75, 42, 112)
    val Purple = Color.rgb(130, 69, 218)
    val PurpleBright = Color.rgb(174, 105, 255)
    val PurpleDeep = Color.rgb(67, 35, 101)
    val PurpleSoft = Color.rgb(205, 177, 236)
    val Lavender = Color.rgb(222, 205, 239)
    val Mint = Color.rgb(82, 216, 181)
    val Error = Color.rgb(255, 112, 135)
    val TextPrimary = Color.rgb(249, 247, 252)
    val TextSecondary = Color.rgb(218, 212, 226)
    val TextMuted = Color.rgb(157, 149, 169)
    val Divider = Color.rgb(53, 44, 64)

    const val HeroTitleSp = 39f
    const val TitleSp = 30f
    const val HeadingSp = 20f
    const val BodySp = 15f
    const val LabelSp = 14f
    const val CaptionSp = 12f
    const val FocusInMs = 92L
    const val FocusOutMs = 72L
    const val SectionTransitionMs = 115L

    val DisplayTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val LabelTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.NORMAL) }
    val MediumTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 22f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF56317C.toInt(), 0xFF24172F.toInt()) else intArrayOf(0xF21D1727.toInt(), 0xF214101B.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) PurpleBright else 0xFF392E46.toInt())
    }

    /** Dark translucent panel used above artwork/video. Kept cheap: no runtime blur. */
    fun glassSurface(radius: Float = 22f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xE6533078.toInt(), 0xE81C1427.toInt()) else intArrayOf(0xD91C1724.toInt(), 0xE6110E17.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1, if (focused) 0xFFCFA7FF.toInt() else 0x66483A58)
    }

    fun elevatedSurface(radius: Float = 24f): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xF5221B2D.toInt(), 0xF514101B.toInt())
    ).apply { cornerRadius = radius; setStroke(1, 0xFF3D304A.toInt()) }

    fun primaryButton(radius: Float = 18f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFAE69FF.toInt(), 0xFF7540C7.toInt()) else intArrayOf(0xFF8245DA.toInt(), 0xFF5B2CA3.toInt())
    ).apply { cornerRadius = radius; setStroke(if (focused) 2 else 1, if (focused) 0xFFF0DFFF.toInt() else 0xFF9363C3.toInt()) }

    fun secondaryButton(radius: Float = 18f, focused: Boolean = false): GradientDrawable = glassSurface(radius, focused)

    fun badge(radius: Float = 12f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius; setColor(0xCC251B31.toInt()); setStroke(1, 0xFF604A75.toInt())
    }

    fun applyTitle(text: TextView) = text.apply { textSize = TitleSp; typeface = DisplayTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyHeroTitle(text: TextView) = text.apply { textSize = HeroTitleSp; typeface = DisplayTypeface; setTextColor(TextPrimary); includeFontPadding = false; letterSpacing = -.01f }
    fun applyHeading(text: TextView) = text.apply { textSize = HeadingSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyBody(text: TextView) = text.apply { textSize = BodySp; typeface = BodyTypeface; setTextColor(TextSecondary); includeFontPadding = false; setLineSpacing(0f, 1.16f) }
    fun applyLabel(text: TextView) = text.apply { textSize = LabelSp; typeface = LabelTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyCaption(text: TextView) = text.apply { textSize = CaptionSp; typeface = MediumTypeface; setTextColor(TextMuted); includeFontPadding = false }

    fun installTvFocus(view: View, radius: Float = 20f, scale: Float = 1.025f, primary: Boolean = false, onFocused: (() -> Unit)? = null) {
        view.isFocusable = true; view.isFocusableInTouchMode = true
        view.background = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        (view as? TextView)?.setTextColor(TextPrimary)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (primary) primaryButton(radius, focused) else secondaryButton(radius, focused)
            (v as? TextView)?.setTextColor(TextPrimary)
            v.animate().cancel()
            v.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 16f else 2f).alpha(if (focused) 1f else .97f)
                .setDuration(if (focused) FocusInMs else FocusOutMs).start()
            if (focused) onFocused?.invoke()
        }
    }
}
