package tv.blofy.player.ui.common

import android.graphics.Color
import tv.blofy.player.BuildConfig
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView
import androidx.core.os.ConfigurationCompat

/**
 * BLOFY's shared visual language. Keep screens visually consistent by defining premium dark-TV
 * surfaces, typography and DPAD focus here instead of styling every screen independently.
 */
object BlofyTvDesign {
    val Background = CinemaStyle.Background
    val BackgroundRaised = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF0B232D.toInt() else Color.rgb(22, 13, 34)
    val Surface = CinemaStyle.Surface
    val SurfaceRaised = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF154250.toInt() else Color.rgb(50, 30, 72)
    val SurfaceFocused = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF126C73.toInt() else Color.rgb(112, 69, 161)
    val FocusStroke = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFE8FFF9.toInt() else Color.rgb(242, 230, 255)
    val FocusGlow = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF5DFFE4.toInt() else Color.rgb(188, 140, 244)

    // Legacy public token names remain API-compatible with all existing screens,
    // but render ocean/cyan ONLY inside CODE_ONLY_LOGIN app builds.
    val Purple = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF1BAEAE.toInt() else Color.rgb(127, 73, 209)
    val PurpleBright = CinemaStyle.Accent
    val PurpleDeep = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF0A3340.toInt() else Color.rgb(53, 28, 80)
    val PurpleSoft = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFB2F2E7.toInt() else Color.rgb(210, 187, 238)
    val Lavender = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFE7FFFA.toInt() else Color.rgb(232, 220, 246)
    val Mint = if (BuildConfig.CODE_ONLY_LOGIN) 0xFF44F1C2.toInt() else Color.rgb(91, 220, 187)
    val Error = Color.rgb(255, 118, 140)

    val TextPrimary = CinemaStyle.White
    val TextSecondary = if (BuildConfig.CODE_ONLY_LOGIN) 0xFFDAF6F4.toInt() else Color.rgb(218, 213, 225)
    val TextMuted = CinemaStyle.Muted
    val Divider = 0x62FFFFFF

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
    const val CardRadius = 16
    const val PanelRadius = 22
    const val ButtonRadius = 14
    const val BadgeRadius = 12
    const val StandardGap = 18
    const val FocusInMs = 95L
    const val FocusOutMs = 75L
    const val SectionTransitionMs = 135L

    val DisplayTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val HeadingTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.BOLD) }
    val LabelTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.BOLD) }
    val BodyTypeface: Typeface by lazy { Typeface.create("sans-serif", Typeface.NORMAL) }
    val MediumTypeface: Typeface by lazy { Typeface.create("sans-serif-medium", Typeface.NORMAL) }

    // The SIL OFL-licensed IBM Plex Arabic fonts are bundled locally. Never fetch fonts
    // during playback; cache both faces after the first TextView render.
    private var arabicRegular: Typeface? = null
    private var arabicSemibold: Typeface? = null

    fun preferredTypeface(view: TextView, bold: Boolean = false): Typeface {
        val arabic = ConfigurationCompat.getLocales(view.resources.configuration)[0]?.language == "ar"
        if (!arabic) return if (bold) HeadingTypeface else MediumTypeface
        return synchronized(this) {
            val cached = if (bold) arabicSemibold else arabicRegular
            cached ?: runCatching {
                Typeface.createFromAsset(
                    view.context.applicationContext.assets,
                    if (bold) "fonts/IBMPlexSansArabic-SemiBold.ttf"
                    else "fonts/IBMPlexSansArabic-Regular.ttf"
                )
            }.getOrElse {
                // Preserve readability on malformed APKs or vendor font engines.
                Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
            }.also { loaded ->
                if (bold) arabicSemibold = loaded else arabicRegular = loaded
            }
        }
    }

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
            if (BuildConfig.CODE_ONLY_LOGIN)
                intArrayOf(0xFFDAFFF6.toInt(), 0xFF60EBD6.toInt(), 0xFF139EAB.toInt())
            else intArrayOf(0xFFB979F4.toInt(), 0xFF8750D7.toInt(), 0xFF6232AA.toInt())
        } else {
            if (BuildConfig.CODE_ONLY_LOGIN)
                intArrayOf(0xFF36D9CD.toInt(), 0xFF1CAAAA.toInt(), 0xFF12788A.toInt())
            else intArrayOf(0xFF874CD5.toInt(), 0xFF6B36B5.toInt(), 0xFF51288F.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(if (focused) 2 else 1,
            if (BuildConfig.CODE_ONLY_LOGIN) (if (focused) 0xFFF0FFFA.toInt() else 0xFF317C83.toInt())
            else (if (focused) 0xFFF0E1FC.toInt() else 0xFF8964AE.toInt()))
    }

    fun secondaryButton(radius: Float = ButtonRadius.toFloat(), focused: Boolean = false) =
        glassSurface(radius, focused)

    fun badge(radius: Float = BadgeRadius.toFloat()) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (BuildConfig.CODE_ONLY_LOGIN)
            intArrayOf(0xE0133945.toInt(), 0xE0092632.toInt())
        else intArrayOf(0xD421182D.toInt(), 0xD617121E.toInt())
    ).apply {
        cornerRadius = radius
        setStroke(1, if (BuildConfig.CODE_ONLY_LOGIN) 0xFF356D75.toInt() else 0xFF584768.toInt())
    }

    fun applyTitle(t: TextView) = t.apply {
        textSize = TitleSp
        typeface = preferredTypeface(this, bold = true)
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.008f
    }

    fun applyHeroTitle(t: TextView) = t.apply {
        textSize = HeroTitleSp
        typeface = preferredTypeface(this, bold = true)
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.015f
    }

    fun applyHeading(t: TextView) = t.apply {
        textSize = HeadingSp
        typeface = preferredTypeface(this, bold = true)
        setTextColor(TextPrimary)
        includeFontPadding = false
        letterSpacing = -.004f
    }

    fun applyBody(t: TextView) = t.apply {
        textSize = BodySp
        typeface = preferredTypeface(this)
        setTextColor(TextSecondary)
        includeFontPadding = false
        setLineSpacing(0f, 1.18f)
    }

    fun applyLabel(t: TextView) = t.apply {
        textSize = LabelSp
        typeface = preferredTypeface(this, bold = true)
        setTextColor(TextPrimary)
        includeFontPadding = false
    }

    fun applyCaption(t: TextView) = t.apply {
        textSize = CaptionSp
        typeface = preferredTypeface(this)
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
