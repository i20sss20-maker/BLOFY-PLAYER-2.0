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
    val Background = 0xFF170D29.toInt()
    val Surface = 0xFF2A1943.toInt()
    val White = 0xFFF3F4F6.toInt()
    val Muted = 0xFFC4B6D8.toInt()
    val Accent = 0xFFC9A6FF.toInt()
    const val ActionHeight = 34

    fun surface(context: Context, focused: Boolean = false, filledFocus: Boolean = false, radiusDp: Int = 8) = GradientDrawable().apply {
        val density = context.resources.displayMetrics.density
        cornerRadius = radiusDp * density
        setColor(if (focused && filledFocus) White else Surface)
        setStroke(((if (focused) 2 else 1) * density).toInt(), if (focused) White else 0x45FFFFFF)
    }

    fun buttonBackground(context: Context, primary: Boolean, focused: Boolean) = GradientDrawable().apply {
        cornerRadius = 6 * context.resources.displayMetrics.density
        setColor(if (primary) Accent else if (focused) 0xFF684397.toInt() else Surface)
        setStroke(((if (focused) 2 else 1) * context.resources.displayMetrics.density).toInt(), if (focused) White else 0x45FFFFFF)
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
