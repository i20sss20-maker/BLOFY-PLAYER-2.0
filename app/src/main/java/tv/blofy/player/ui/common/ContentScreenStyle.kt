package tv.blofy.player.ui.common

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button
import tv.blofy.player.core.device.DeviceClass

/** Premium surfaces used only by movie/series/episode presentation screens. */
object ContentScreenStyle {
    fun actionBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFF4E9FF.toInt(), 0xFFDCC1FF.toInt())
            primary -> intArrayOf(0xFFE0C7FF.toInt(), 0xFFB983EF.toInt())
            focused -> intArrayOf(0xA06F48A0.toInt(), 0x7A452A63.toInt())
            else -> intArrayOf(0x5A21142F, 0x3E120C1B)
        }
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 16f * d
        setStroke(
            ((if (focused) 2 else 1) * d).toInt(),
            if (focused) 0xFFF0DFFF.toInt() else 0x55FFFFFF
        )
    }

    fun styleAction(button: Button, primary: Boolean = false) {
        val d = button.resources.displayMetrics.density
        button.apply {
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            setPadding((16 * d).toInt(), 0, (16 * d).toInt(), 0)
            textSize = 12.5f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            isSingleLine = true
            isFocusable = true
            isFocusableInTouchMode = DeviceClass.detect(context) == DeviceClass.Kind.TV
            stateListAnimator = null
            backgroundTintList = null
            elevation = 0f
            setTextColor(if (primary) 0xFF130B1D.toInt() else Color.WHITE)
            background = actionBackground(context, primary, false)
            setOnFocusChangeListener { view, focused ->
                background = actionBackground(context, primary, focused)
                setTextColor(if (primary) 0xFF130B1D.toInt() else Color.WHITE)
                view.animate().cancel()
                val scale = if (focused) TvUiTuning.focusScale(context, 1.018f) else 1f
                view.animate()
                    .scaleX(scale)
                    .scaleY(scale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(context, 8f) else 0f)
                    .setDuration(TvUiTuning.focusDuration(context, focused))
                    .start()
            }
        }
    }

    fun softSurface(context: Context, focused: Boolean = false, radiusDp: Int = 14) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) {
            intArrayOf(0xA35A3B74.toInt(), 0x7B34204D.toInt(), 0x4A160F23.toInt())
        } else {
            intArrayOf(0x30291B39, 0x21171027, 0x16100B19)
        }
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = radiusDp * d
        setStroke(
            (1f * d).toInt().coerceAtLeast(1),
            if (focused) 0x669D75C2.toInt() else 0x12FFFFFF
        )
    }

    fun detailsPanel(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(
            0x86291A38.toInt(),
            0x661A1026.toInt(),
            0x42110B19.toInt()
        )
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 22f * d
        setStroke((1f * d).toInt().coerceAtLeast(1), 0x42D8BCFF)
    }

    fun chip(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0x702F1E41, 0x4A180F23)
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 12f * d
        setStroke((1f * d).toInt().coerceAtLeast(1), 0x52E2D1FF)
    }
}
