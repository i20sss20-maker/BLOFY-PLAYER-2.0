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
    val Background = 0xFF07070A.toInt()
    val Surface = 0xFF1A1620.toInt()
    val White = 0xFFF3F4F6.toInt()
    val Muted = 0xFFBEB7C6.toInt()
    val Accent = 0xFFC7A8F2.toInt()
    const val ActionHeight = 34

    fun surface(context: Context, focused: Boolean = false, filledFocus: Boolean = false, radiusDp: Int = 8) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        when {
            focused && filledFocus -> intArrayOf(0xFFE9DCFA.toInt(), Accent, 0xFFAD86D4.toInt())
            focused -> intArrayOf(0xFF514061.toInt(), 0xFF342A3D.toInt(), Surface)
            else -> intArrayOf(Surface, 0xFF100E14.toInt())
        }
    ).apply {
        val density = context.resources.displayMetrics.density
        cornerRadius = radiusDp * density
        setStroke(
            ((if (focused) 2 else 1) * density).toInt(),
            if (focused) 0xFFEBDFFD.toInt() else 0x32FFFFFF
        )
    }

    fun buttonBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFEADFFC.toInt(), 0xFFD0B7EB.toInt(), 0xFFB18BD5.toInt())
            primary -> intArrayOf(Accent, 0xFFA97CCE.toInt())
            focused -> intArrayOf(0xFF5A476B.toInt(), 0xFF392E43.toInt())
            else -> intArrayOf(Surface, 0xFF121018.toInt())
        }
    ).apply {
        cornerRadius = 6 * context.resources.displayMetrics.density
        setStroke(
            ((if (focused) 2 else 1) * context.resources.displayMetrics.density).toInt(),
            if (focused) 0xFFF1E7FD.toInt() else 0x32FFFFFF
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
