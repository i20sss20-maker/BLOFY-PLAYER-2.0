package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** BLOFY premium light visual system. UI only; playback/network behavior is untouched. */
object BlofyTvDesign {
    val Background = Color.rgb(245, 245, 248)
    val BackgroundRaised = Color.rgb(250, 250, 252)
    val Surface = Color.rgb(255, 255, 255)
    val SurfaceRaised = Color.rgb(250, 249, 253)
    val SurfaceFocused = Color.rgb(244, 238, 255)
    val Purple = Color.rgb(104, 42, 204)
    val PurpleBright = Color.rgb(132, 69, 225)
    val PurpleDeep = Color.rgb(75, 24, 159)
    val PurpleSoft = Color.rgb(119, 72, 190)
    val Mint = Color.rgb(25, 154, 116)
    val TextPrimary = Color.rgb(24, 21, 29)
    val TextSecondary = Color.rgb(66, 61, 73)
    val TextMuted = Color.rgb(123, 116, 132)
    val Divider = Color.rgb(226, 222, 232)

    const val HeroTitleSp = 39f
    const val TitleSp = 30f
    const val HeadingSp = 20f
    const val BodySp = 15f
    const val LabelSp = 14f
    const val CaptionSp = 12f

    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    fun surface(radius: Float = 24f, focused: Boolean = false): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(if (focused) 0xFFF4EEFF.toInt() else 0xFFFFFFFF.toInt())
        setStroke(if (focused) 3 else 1, if (focused) Purple else 0xFFE3DFE9.toInt())
    }

    fun elevatedSurface(radius: Float = 26f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(0xFFFCFBFE.toInt())
        setStroke(1, 0xFFE1DCE8.toInt())
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF8245E1.toInt(), 0xFF5D22B8.toInt())
        else intArrayOf(0xFF7131CF.toInt(), 0xFF5620AA.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) 0xFFE7D5FF.toInt() else 0xFF6C35BA.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(if (focused) 0xFFF2E9FF.toInt() else 0xFFFFFFFF.toInt())
        setStroke(if (focused) 3 else 1, if (focused) Purple else 0xFFD9D3E1.toInt())
    }

    fun badge(radius: Float = 14f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(0xFFF1E9FB.toInt())
        setStroke(1, 0xFFD8C5F2.toInt())
    }

    fun applyTitle(text: TextView) = text.apply { textSize = TitleSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyHeroTitle(text: TextView) = text.apply { textSize = HeroTitleSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyHeading(text: TextView) = text.apply { textSize = HeadingSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyBody(text: TextView) = text.apply { textSize = BodySp; typeface = BodyTypeface; setTextColor(TextSecondary); includeFontPadding = false; setLineSpacing(0f, 1.12f) }
    fun applyLabel(text: TextView) = text.apply { textSize = LabelSp; typeface = BodyTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyCaption(text: TextView) = text.apply { textSize = CaptionSp; typeface = BodyTypeface; setTextColor(TextMuted); includeFontPadding = false }

    fun installTvFocus(view: View, radius: Float = 20f, scale: Float = 1.04f, primary: Boolean = false, onFocused: (() -> Unit)? = null) {
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.background = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        (view as? TextView)?.setTextColor(if (primary) Color.WHITE else TextPrimary)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (primary) primaryButton(radius, focused) else secondaryButton(radius, focused)
            (v as? TextView)?.setTextColor(if (primary) Color.WHITE else TextPrimary)
            v.animate().cancel()
            v.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 18f else 2f).alpha(1f).setDuration(if (focused) 105L else 85L).start()
            if (focused) onFocused?.invoke()
        }
    }
}
