package tv.blofy.player.ui.common

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import android.widget.TextView
import tv.blofy.player.core.device.DeviceClass

/** Reusable BLOFY layout primitives. Keeps structure consistent while preserving the original palette. */
object BlofyUiKit {
    val Background = 0xFF07070A.toInt()
    val BackgroundRaised = 0xFF100E14.toInt()
    val Surface = 0xFF1A1620.toInt()
    val SurfaceRaised = 0xFF2B2432.toInt()
    val Purple = 0xFF8654C5.toInt()
    val PurpleBright = 0xFFC7A8F2.toInt()
    val PurpleDeep = 0xFF362443.toInt()
    val PurpleSoft = 0xFFD8C5E9.toInt()
    val White = 0xFFF3F4F6.toInt()
    val Muted = 0xFFBEB7C6.toInt()

    fun screen(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(BackgroundRaised, Background, 0xFF050508.toInt())
    )

    fun panel(context: Context, focused: Boolean = false, radiusDp: Int = 14) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF514061.toInt(), PurpleDeep, Surface)
        else intArrayOf(Surface, 0xFF100E14.toInt())
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = radiusDp * d
        setStroke((if (focused) 2 else 1) * d.toInt().coerceAtLeast(1), if (focused) PurpleBright else 0x42FFFFFF)
    }

    fun posterPlaceholder(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF211A2B.toInt(), 0xFF17131E.toInt(), Background)
    ).apply { cornerRadius = 8f * context.resources.displayMetrics.density }

    fun button(context: Context, primary: Boolean, focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFE9DCFA.toInt(), PurpleBright, 0xFFAD86D4.toInt())
            primary -> intArrayOf(PurpleBright, 0xFFA97CCE.toInt())
            focused -> intArrayOf(0xFF5A476B.toInt(), 0xFF392E43.toInt())
            else -> intArrayOf(Surface, 0xFF121018.toInt())
        }
    ).apply {
        cornerRadius = 8f * context.resources.displayMetrics.density
        setStroke((if (focused) 2 else 1) * context.resources.displayMetrics.density.toInt().coerceAtLeast(1), if (focused) 0xFFF1E7FD.toInt() else 0x42FFFFFF)
    }

    fun styleButton(button: Button, primary: Boolean = false) {
        button.apply {
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(16), 0, dp(16), 0)
            gravity = Gravity.CENTER
            textSize = 13f
            setTextColor(if (primary) Background else White)
            stateListAnimator = null
            background = this@BlofyUiKit.button(context, primary)
            isFocusable = true
            isFocusableInTouchMode = DeviceClass.isTv(context)
            setOnFocusChangeListener { view, focused ->
                view.background = this@BlofyUiKit.button(context, primary, focused)
                view.setTextColor(if (primary) Background else White)
                view.animate().cancel()
                val scale = if (focused) TvUiTuning.focusScale(context, 1.025f) else 1f
                view.animate().scaleX(scale).scaleY(scale).setDuration(TvUiTuning.focusDuration(context, focused)).start()
            }
        }
    }

    fun title(view: TextView) = view.apply {
        textSize = 24f
        typeface = BlofyTvDesign.HeadingTypeface
        setTextColor(White)
        includeFontPadding = false
    }

    fun caption(view: TextView) = view.apply {
        textSize = 12f
        typeface = BlofyTvDesign.BodyTypeface
        setTextColor(Muted)
        includeFontPadding = false
    }

    private fun Context.dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
