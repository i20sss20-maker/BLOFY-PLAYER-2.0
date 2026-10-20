package tv.blofy.player.ui.common

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import tv.blofy.player.core.device.DeviceClass
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout

/** Shared cinematic actions: compact visuals and a distinct remote focus state. */
object CinemaStyle {
    // BLOFY Cinema palette: graphite black, cinematic red, warm white and restrained gold.
    val Background = 0xFF08090B.toInt()
    val Surface = 0xFF15171B.toInt()
    val White = 0xFFF5F5F1.toInt()
    val Muted = 0xFFA7AAA8.toInt()
    val Accent = 0xFFE50914.toInt()
    val Gold = 0xFFF2C66D.toInt()
    const val ActionHeight = 34

    fun surface(context: Context, focused: Boolean = false, filledFocus: Boolean = false, radiusDp: Int = 8) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        when {
            focused && filledFocus -> intArrayOf(0xFFFF4B55.toInt(), Accent, 0xFFA80710.toInt())
            focused -> intArrayOf(0xFF5B1E24.toInt(), 0xFF32161A.toInt(), Surface)
            else -> intArrayOf(Surface, 0xFF0D0F12.toInt())
        }
    ).apply {
        val density = context.resources.displayMetrics.density
        cornerRadius = radiusDp * density
        setStroke(
            ((if (focused) 2 else 1) * density).toInt(),
            if (focused) 0xFFFFE7E7.toInt() else 0x3AFFFFFF
        )
    }

    fun buttonBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFFF6B70.toInt(), Accent, 0xFFA80710.toInt())
            primary -> intArrayOf(Accent, 0xFFB20710.toInt())
            focused -> intArrayOf(0xFF5B1E24.toInt(), 0xFF32161A.toInt())
            else -> intArrayOf(Surface, 0xFF0D0F12.toInt())
        }
    ).apply {
        cornerRadius = 6 * context.resources.displayMetrics.density
        setStroke(
            ((if (focused) 2 else 1) * context.resources.displayMetrics.density).toInt(),
            if (focused) 0xFFFFE7E7.toInt() else 0x3AFFFFFF
        )
    }

    fun styleButton(button: Button, primary: Boolean = false, onFocus: ((Boolean) -> Unit)? = null) {
        val density = button.resources.displayMetrics.density
        button.apply {
            isAllCaps = false
            minHeight = 0; minimumHeight = 0; minWidth = 0; minimumWidth = 0
            setPadding((12 * density).toInt(), 0, (12 * density).toInt(), 0)
            textSize = 12f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            isSingleLine = true
            ellipsize = TextUtils.TruncateAt.END
            isFocusable = true
            isFocusableInTouchMode = DeviceClass.detect(context) == DeviceClass.Kind.TV
            stateListAnimator = null
            backgroundTintList = null
            elevation = 0f
            background = buttonBackground(context, primary, false)
            setTextColor(if (primary) Background else White)
            setOnFocusChangeListener { view, focused ->
                background = buttonBackground(context, primary, focused)
                setTextColor(if (primary) Background else White)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(context, 1.028f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(context, 8 * density) else 0f)
                    .setDuration(TvUiTuning.focusDuration(context, focused))
                    .start()
                onFocus?.invoke(focused)
            }
        }
    }

    /** Long translated labels and optional trailer/resume actions remain reachable. */
    fun actionStrip(context: Context, row: LinearLayout) = HorizontalScrollView(context).apply {
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        isFocusable = false
        isFocusableInTouchMode = false
        layoutDirection = context.resources.configuration.layoutDirection
        clipToPadding = false
        val inset = (3 * resources.displayMetrics.density).toInt()
        setPadding(inset, inset, inset, inset)
        addView(row, FrameLayout.LayoutParams(-2, -2))
    }
}
