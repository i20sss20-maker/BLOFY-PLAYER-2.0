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
            primary && focused -> intArrayOf(0xFFF2E9FA.toInt(), 0xFFD8C4EA.toInt())
            primary -> intArrayOf(0xFFD9C2EA.toInt(), 0xFFB48DD0.toInt())
            focused -> intArrayOf(0xB05A4969.toInt(), 0x8A392E43.toInt())
            else -> intArrayOf(0x70221D29, 0x50141018)
        }
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 16f * d
        setStroke(
            ((if (focused) 2 else 1) * d).toInt(),
            if (focused) 0xFFF2E8FB.toInt() else 0x32FFFFFF
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
            intArrayOf(0xB052435F.toInt(), 0x88342A3D.toInt(), 0x5818151D.toInt())
        } else {
            intArrayOf(0x40231E29, 0x3018151D, 0x24100E13)
        }
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = radiusDp * d
        setStroke(
            (1f * d).toInt().coerceAtLeast(1),
            if (focused) 0x667E678D.toInt() else 0x18FFFFFF
        )
    }

    fun detailsPanel(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(
            0x8A25202B.toInt(),
            0x6819151E.toInt(),
            0x46100E14.toInt()
        )
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 22f * d
        setStroke((1f * d).toInt().coerceAtLeast(1), 0x36D8C6EA)
    }

    fun chip(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0x70302838, 0x4A18141C)
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 12f * d
        setStroke((1f * d).toInt().coerceAtLeast(1), 0x46D8C8E5)
    }
}
