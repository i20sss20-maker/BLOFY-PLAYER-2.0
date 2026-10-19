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
    val Background = 0xFF07050B.toInt()
    val Surface = 0xFF211332.toInt()
    val White = 0xFFF3F4F6.toInt()
    val Muted = 0xFFC4B6D8.toInt()
    val Accent = 0xFFC9A6FF.toInt()
    const val ActionHeight = 34

    fun surface(context: Context, focused: Boolean = false, filledFocus: Boolean = false, radiusDp: Int = 8) =
        GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            when {
                focused && filledFocus -> intArrayOf(0xFFF1E5FF.toInt(), Accent)
                focused -> intArrayOf(0xFF6C448E.toInt(), 0xFF2A173B.toInt())
                else -> intArrayOf(0xF12A1739.toInt(), 0xF10B0816.toInt())
            }
        ).apply {
            val density = context.resources.displayMetrics.density
            cornerRadius = radiusDp * density
            setStroke(((if (focused) 2 else 1) * density).toInt(),
                if (focused) White else 0x527A5B99)
        }

    fun buttonBackground(context: Context, primary: Boolean, focused: Boolean) =
        GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            when {
                primary && focused -> intArrayOf(0xFFF1DFFF.toInt(), 0xFFB585F4.toInt())
                primary -> intArrayOf(Accent, 0xFFAD78E6.toInt())
                focused -> intArrayOf(0xFF7852A7.toInt(), 0xFF38234D.toInt())
                else -> intArrayOf(0xFF2B1B3C.toInt(), 0xFF130B1E.toInt())
            }
        ).apply {
            val density = context.resources.displayMetrics.density
            cornerRadius = 14 * density
            setStroke(((if (focused) 2 else 1) * density).toInt(),
                if (focused) White else 0x527A5B99)
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
                view.animate().scaleX(if (focused) 1.02f else 1f).scaleY(if (focused) 1.02f else 1f)
                    .setDuration(120).start()
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
