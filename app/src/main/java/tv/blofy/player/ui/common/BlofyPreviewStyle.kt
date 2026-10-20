package tv.blofy.player.ui.common

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button

/** Visual system for the approved BLOFY preview. It is deliberately isolated from legacy styles. */
object BlofyPreviewStyle {
    val Screen = 0xFF090A0F.toInt()
    val ScreenRaised = 0xFF11131B.toInt()
    val Surface = 0xFF171923.toInt()
    val SurfaceRaised = 0xFF252638.toInt()
    val Purple = 0xFF8B5CC2.toInt()
    val PurpleBright = 0xFFB99BEA.toInt()
    val PurpleSoft = 0xFFD8C9F0.toInt()
    val Text = 0xFFF7F5FA.toInt()
    val Muted = 0xFFA9A6B5.toInt()

    fun screen(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(ScreenRaised, Screen, 0xFF07080C.toInt())
    )

    fun panel(context: Context, focused: Boolean = false, radiusDp: Int = 16) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF3C3150.toInt(), SurfaceRaised, Surface)
        else intArrayOf(Surface, 0xFF101119.toInt())
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = radiusDp * d
        setStroke((if (focused) 2 else 1) * d.toInt().coerceAtLeast(1), if (focused) PurpleBright else 0x36FFFFFF)
    }

    fun selectedNav(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0xFF5D3E84.toInt(), 0xFF342747.toInt())
    ).apply {
        cornerRadius = 12f * context.resources.displayMetrics.density
        setStroke((1.5f * context.resources.displayMetrics.density).toInt(), PurpleBright)
    }

    fun button(context: Context, primary: Boolean, focused: Boolean = false) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFE6D9FB.toInt(), PurpleBright)
            primary -> intArrayOf(PurpleBright, 0xFF9770C8.toInt())
            focused -> intArrayOf(0xFF4A3B5C.toInt(), 0xFF2A2235.toInt())
            else -> intArrayOf(SurfaceRaised, Surface)
        }
    ).apply {
        cornerRadius = 9f * context.resources.displayMetrics.density
        setStroke((if (focused) 2 else 1) * context.resources.displayMetrics.density.toInt().coerceAtLeast(1), if (focused) PurpleBright else 0x42FFFFFF)
    }

    fun styleButton(button: Button, primary: Boolean, onFocus: ((Boolean) -> Unit)? = null) {
        button.apply {
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            setPadding(context.dp(16), 0, context.dp(16), 0)
            gravity = Gravity.CENTER
            textSize = 12.5f
            setTextColor(if (primary) Screen else Text)
            background = this@BlofyPreviewStyle.button(context, primary)
            stateListAnimator = null
            setOnFocusChangeListener { view, focused ->
                background = this@BlofyPreviewStyle.button(context, primary, focused)
                setTextColor(if (primary) Screen else Text)
                val scale = if (focused) TvUiTuning.focusScale(context, 1.025f) else 1f
                view.animate().cancel()
                view.animate().scaleX(scale).scaleY(scale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(context, 8f) else 0f)
                    .setDuration(TvUiTuning.focusDuration(context, focused)).start()
                onFocus?.invoke(focused)
            }
        }
    }

    private fun Context.dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
