package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView

/** BLOFY cinematic premium visual system. UI only; playback/network behavior is untouched. */
object BlofyTvDesign {
    val Background = Color.rgb(13, 10, 24)
    val BackgroundRaised = Color.rgb(22, 16, 38)
    val Surface = Color.rgb(29, 22, 48)
    val SurfaceRaised = Color.rgb(37, 28, 59)
    val SurfaceFocused = Color.rgb(86, 42, 142)
    val Purple = Color.rgb(132, 63, 230)
    val PurpleBright = Color.rgb(169, 91, 255)
    val PurpleDeep = Color.rgb(72, 28, 132)
    val PurpleSoft = Color.rgb(201, 164, 244)
    val Mint = Color.rgb(67, 218, 178)
    val TextPrimary = Color.rgb(249, 247, 252)
    val TextSecondary = Color.rgb(221, 214, 230)
    val TextMuted = Color.rgb(168, 157, 183)
    val Divider = Color.rgb(69, 54, 88)

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
        if (focused) intArrayOf(0xFF6F38B8.toInt(), 0xFF342047.toInt()) else intArrayOf(0xFF241A36.toInt(), 0xFF171122.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) PurpleBright else 0xFF49375E.toInt())
    }

    fun elevatedSurface(radius: Float = 26f): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF2C2041.toInt(), 0xFF191222.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, 0xFF513B69.toInt())
    }

    fun primaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt()) else intArrayOf(0xFF843FE6.toInt(), 0xFF5720AD.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 3 else 1, if (focused) 0xFFF0DFFF.toInt() else 0xFF9D68D5.toInt())
    }

    fun secondaryButton(radius: Float = 20f, focused: Boolean = false): GradientDrawable = surface(radius, focused)

    fun badge(radius: Float = 14f): GradientDrawable = GradientDrawable().apply {
        cornerRadius = radius
        setColor(0xFF342248.toInt())
        setStroke(1, 0xFF76539A.toInt())
    }

    fun applyTitle(text: TextView) = text.apply { textSize = TitleSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyHeroTitle(text: TextView) = text.apply { textSize = HeroTitleSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyHeading(text: TextView) = text.apply { textSize = HeadingSp; typeface = HeadingTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyBody(text: TextView) = text.apply { textSize = BodySp; typeface = BodyTypeface; setTextColor(TextSecondary); includeFontPadding = false; setLineSpacing(0f, 1.12f) }
    fun applyLabel(text: TextView) = text.apply { textSize = LabelSp; typeface = BodyTypeface; setTextColor(TextPrimary); includeFontPadding = false }
    fun applyCaption(text: TextView) = text.apply { textSize = CaptionSp; typeface = BodyTypeface; setTextColor(TextMuted); includeFontPadding = false }

    fun installTvFocus(view: View, radius: Float = 20f, scale: Float = 1.025f, primary: Boolean = false, onFocused: (() -> Unit)? = null) {
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.background = if (primary) primaryButton(radius, false) else secondaryButton(radius, false)
        (view as? TextView)?.setTextColor(TextPrimary)
        view.setOnFocusChangeListener { v, focused ->
            v.background = if (primary) primaryButton(radius, focused) else secondaryButton(radius, focused)
            (v as? TextView)?.setTextColor(TextPrimary)
            v.animate().cancel()
            v.animate().scaleX(if (focused) scale else 1f).scaleY(if (focused) scale else 1f)
                .translationZ(if (focused) 18f else 2f).alpha(1f).setDuration(if (focused) 95L else 75L).start()
            if (focused) onFocused?.invoke()
        }
    }
}
