package tv.blofy.player.ui.common

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.Button

/** Premium surfaces used only by movie/series/episode presentation screens. */
object ContentScreenStyle {
    fun actionBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFF0E2FF.toInt(), 0xFFD9BDFF.toInt())
            primary -> intArrayOf(0xFFD8B7FF.toInt(), 0xFFB77CEB.toInt())
            focused -> intArrayOf(0xB3664188.toInt(), 0xA53A2455.toInt())
            else -> intArrayOf(0x521A1126, 0x38120D19)
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
            intArrayOf(0xC94D2E67.toInt(), 0xA7271838.toInt(), 0x8A130E1B.toInt())
        } else {
            intArrayOf(0x2B251831, 0x20170F21, 0x18100B17)
        }
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = radiusDp * d
        setStroke(
            ((if (focused) 2 else 1) * d).toInt(),
            if (focused) 0xFFEAD7FF.toInt() else 0x24FFFFFF
        )
    }

    fun chip(context: Context) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        intArrayOf(0x48231931, 0x32130D1B)
    ).apply {
        val d = context.resources.displayMetrics.density
        cornerRadius = 12f * d
        setStroke((1f * d).toInt().coerceAtLeast(1), 0x3DFFFFFF)
    }
}
