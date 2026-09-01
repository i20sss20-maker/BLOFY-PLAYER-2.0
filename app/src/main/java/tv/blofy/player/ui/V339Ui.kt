package tv.blofy.player.ui

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.PixelFormat
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Exact visual constants/behaviour ported from BLOFY-PLAYER-2026 v339-stability-from-v338 BlofyUi. */
object V339Ui {
    val BLACK = Color.rgb(5, 5, 12)
    val NAVY = Color.rgb(9, 9, 20)
    val PANEL = Color.rgb(17, 16, 30)
    val PANEL_ALT = Color.rgb(24, 20, 42)
    val PANEL_SOFT = Color.rgb(38, 25, 68)
    val PURPLE = Color.rgb(124, 43, 255)
    val PURPLE_DARK = Color.rgb(72, 12, 171)
    val PURPLE_LIGHT = Color.rgb(188, 132, 255)
    val CYAN = Color.rgb(77, 212, 224)
    val TEXT = Color.rgb(249, 248, 252)
    val MUTED = Color.rgb(169, 166, 181)
    val SUCCESS = Color.rgb(66, 221, 157)
    val ERROR = Color.rgb(255, 105, 137)
    val STROKE = Color.rgb(48, 39, 76)
    val DIVIDER = Color.rgb(34, 28, 52)

    fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun isTv(context: Context): Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION

    fun text(context: Context, value: String, sp: Float, color: Int = TEXT) = TextView(context).apply {
        text = value
        textSize = sp
        setTextColor(color)
        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
        textDirection = View.TEXT_DIRECTION_FIRST_STRONG
        includeFontPadding = false
        setPadding(dp(context, 8), dp(context, 4), dp(context, 8), dp(context, 4))
    }

    fun title(context: Context, value: String, sp: Float) = text(context, value, sp, TEXT).apply {
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        letterSpacing = 0.005f
    }

    fun chip(context: Context, value: String) = text(context, value, 11f, TEXT).apply {
        gravity = Gravity.CENTER
        isSingleLine = true
        background = panel(context, Color.argb(205, 21, 19, 34), 8, STROKE)
        setPadding(dp(context, 10), 0, dp(context, 10), 0)
    }

    fun button(context: Context, label: String, primary: Boolean): Button = Button(context).apply {
        text = label
        setTextColor(TEXT)
        textSize = 14f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        isAllCaps = false
        gravity = Gravity.CENTER
        setPadding(dp(context, 16), 0, dp(context, 16), 0)
        background = if (primary) primaryButtonDrawable(context)
        else focusDrawable(context, Color.argb(210, 23, 21, 36), PANEL_SOFT, PURPLE_LIGHT)
        isFocusable = true
        stateListAnimator = null
        attachScaleFocus(this, 1.008f)
        setOnKeyListener { v, keyCode, event ->
            if (event.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
            val direction = when (keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> View.FOCUS_LEFT
                KeyEvent.KEYCODE_DPAD_RIGHT -> View.FOCUS_RIGHT
                KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
                KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
                else -> return@setOnKeyListener false
            }
            val next = v.focusSearch(direction)
            if (next == null || next === v) false else { next.requestFocus(); true }
        }
    }

    fun navChip(context: Context, label: String) = title(context, label, 14f).apply {
        gravity = Gravity.CENTER
        isFocusable = true
        isClickable = true
        background = focusDrawable(context, Color.TRANSPARENT, PANEL_SOFT, PURPLE_LIGHT)
        setPadding(dp(context, 18), 0, dp(context, 18), 0)
        attachScaleFocus(this, 1.006f)
    }

    fun sidebarItem(context: Context, icon: String, label: String, selected: Boolean) =
        title(context, "$icon    $label", 14f).apply {
            textDirection = View.TEXT_DIRECTION_RTL
            gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            isSingleLine = true
            setPadding(dp(context, 18), 0, dp(context, 18), 0)
            background = if (selected) selectedDrawable(context)
            else focusDrawable(context, Color.TRANSPARENT, PANEL_SOFT, PURPLE_LIGHT)
            if (!selected) setTextColor(Color.rgb(213, 210, 221))
            attachScaleFocus(this, 1.006f)
        }

    fun panel(context: Context, color: Int, radiusDp: Int, strokeColor: Int): Drawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(context, radiusDp.coerceAtLeast(0)).toFloat()
        if (strokeColor != Color.TRANSPARENT) setStroke(dp(context, 1), strokeColor)
    }

    fun gradientPanel(context: Context, start: Int, end: Int, radiusDp: Int, strokeColor: Int): Drawable =
        GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(start, end)).apply {
            cornerRadius = dp(context, radiusDp).toFloat()
            if (strokeColor != Color.TRANSPARENT) setStroke(dp(context, 1), strokeColor)
        }

    fun focusDrawable(context: Context, normal: Int, focused: Int, focusStroke: Int): Drawable = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_pressed), rounded(context, PURPLE_DARK, 13, PURPLE_LIGHT, 2))
        addState(intArrayOf(android.R.attr.state_focused), rounded(context, focused, 13, focusStroke, 2))
        addState(intArrayOf(), rounded(context, normal, 13, if (normal == Color.TRANSPARENT) Color.TRANSPARENT else STROKE, 1))
    }

    private fun primaryButtonDrawable(context: Context): Drawable = StateListDrawable().apply {
        val focused = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.rgb(151, 70, 255), Color.rgb(102, 27, 224))).apply {
            cornerRadius = dp(context, 13).toFloat(); setStroke(dp(context, 2), Color.WHITE)
        }
        val idle = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.rgb(128, 44, 255), Color.rgb(91, 20, 206))).apply {
            cornerRadius = dp(context, 13).toFloat(); setStroke(dp(context, 1), PURPLE_LIGHT)
        }
        addState(intArrayOf(android.R.attr.state_pressed), focused)
        addState(intArrayOf(android.R.attr.state_focused), focused)
        addState(intArrayOf(), idle)
    }

    private fun selectedDrawable(context: Context): Drawable = StateListDrawable().apply {
        val focused = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.rgb(84, 25, 160), Color.rgb(37, 18, 76))).apply {
            cornerRadius = dp(context, 14).toFloat(); setStroke(dp(context, 2), PURPLE_LIGHT)
        }
        val idle = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.rgb(62, 19, 124), Color.rgb(31, 15, 62))).apply {
            cornerRadius = dp(context, 14).toFloat(); setStroke(dp(context, 1), Color.rgb(112, 53, 196))
        }
        addState(intArrayOf(android.R.attr.state_focused), focused)
        addState(intArrayOf(android.R.attr.state_pressed), focused)
        addState(intArrayOf(), idle)
    }

    private fun rounded(context: Context, color: Int, radiusDp: Int, stroke: Int, strokeDp: Int) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(context, radiusDp).toFloat()
        if (stroke != Color.TRANSPARENT) setStroke(dp(context, strokeDp), stroke)
    }

    fun screenGradient(): Drawable = object : Drawable() {
        private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        override fun draw(canvas: android.graphics.Canvas) {
            paint.shader = LinearGradient(0f, 0f, canvas.width.toFloat(), canvas.height.toFloat(),
                intArrayOf(Color.rgb(4,4,10), Color.rgb(7,6,15), Color.rgb(11,8,25), Color.rgb(5,5,12)),
                floatArrayOf(0f, .42f, .78f, 1f), Shader.TileMode.CLAMP)
            canvas.drawRect(bounds, paint)
            paint.shader = null
            paint.color = Color.argb(16, 124, 43, 255)
            canvas.drawCircle(canvas.width * .78f, canvas.height * .86f, canvas.width * .34f, paint)
        }
        override fun setAlpha(alpha: Int) { paint.alpha = alpha }
        override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) { paint.colorFilter = colorFilter }
        override fun getOpacity() = PixelFormat.OPAQUE
    }

    fun heroScrim(): Drawable = object : Drawable() {
        private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        override fun draw(canvas: android.graphics.Canvas) {
            paint.shader = LinearGradient(0f, 0f, canvas.width.toFloat(), 0f,
                intArrayOf(Color.argb(248,6,6,13), Color.argb(218,7,7,15), Color.argb(74,7,6,15), Color.argb(8,7,6,15)),
                floatArrayOf(0f, .34f, .72f, 1f), Shader.TileMode.CLAMP)
            canvas.drawRect(bounds, paint)
        }
        override fun setAlpha(alpha: Int) { paint.alpha = alpha }
        override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) { paint.colorFilter = colorFilter }
        override fun getOpacity() = PixelFormat.TRANSLUCENT
    }

    fun attachScaleFocus(view: View, scale: Float) {
        view.setOnFocusChangeListener { v, focused ->
            val target = if (focused) scale.coerceAtMost(1.008f) else 1f
            v.animate().cancel()
            v.animate().scaleX(target).scaleY(target).setDuration(90).start()
            v.elevation = if (focused) dp(v.context, 8).toFloat() else 0f
        }
    }

    fun progressColors() = ColorStateList.valueOf(PURPLE)
}
