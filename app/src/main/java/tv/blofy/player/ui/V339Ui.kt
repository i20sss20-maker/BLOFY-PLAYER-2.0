package tv.blofy.player.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.Drawable
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import tv.blofy.player.V339OriginalBridge

/** Compatibility facade. Every visual primitive delegates to the untouched v339 BlofyUi.java. */
object V339Ui {
    val BLACK = V339OriginalBridge.BLACK
    val NAVY = V339OriginalBridge.NAVY
    val PANEL = V339OriginalBridge.PANEL
    val PANEL_ALT = V339OriginalBridge.PANEL_ALT
    val PANEL_SOFT = V339OriginalBridge.PANEL_SOFT
    val PURPLE = V339OriginalBridge.PURPLE
    val PURPLE_DARK = V339OriginalBridge.PURPLE_DARK
    val PURPLE_LIGHT = V339OriginalBridge.PURPLE_LIGHT
    val CYAN = V339OriginalBridge.CYAN
    val TEXT = V339OriginalBridge.TEXT
    val MUTED = V339OriginalBridge.MUTED
    val SUCCESS = V339OriginalBridge.SUCCESS
    val ERROR = V339OriginalBridge.ERROR
    val STROKE = V339OriginalBridge.STROKE
    val DIVIDER = V339OriginalBridge.DIVIDER

    fun dp(context: Context, value: Int): Int = V339OriginalBridge.dp(context, value)
    fun isTv(context: Context): Boolean = V339OriginalBridge.isTv(context)
    fun text(context: Context, value: String, sp: Float, color: Int = TEXT): TextView =
        V339OriginalBridge.text(context, value, sp.toInt(), color)
    fun title(context: Context, value: String, sp: Float): TextView =
        V339OriginalBridge.title(context, value, sp.toInt())
    fun chip(context: Context, value: String): TextView = V339OriginalBridge.chip(context, value)
    fun input(context: Context, hint: String, numeric: Boolean = false): EditText =
        V339OriginalBridge.input(context, hint, numeric)
    fun button(context: Context, label: String, primary: Boolean): Button =
        V339OriginalBridge.button(context, label, primary)
    fun navChip(context: Context, label: String): TextView = V339OriginalBridge.navChip(context, label)
    fun sidebarItem(context: Context, icon: String, label: String, selected: Boolean): TextView =
        V339OriginalBridge.sidebarItem(context, icon, label, selected)
    fun panel(context: Context, color: Int, radiusDp: Int, strokeColor: Int): Drawable =
        V339OriginalBridge.panel(context, color, radiusDp, strokeColor)
    fun gradientPanel(context: Context, start: Int, end: Int, radiusDp: Int, strokeColor: Int): Drawable =
        V339OriginalBridge.gradientPanel(context, start, end, radiusDp, strokeColor)
    fun focusDrawable(context: Context, normal: Int, focused: Int, focusStroke: Int): Drawable =
        V339OriginalBridge.focusDrawable(context, normal, focused, focusStroke)
    fun screenGradient(): Drawable = V339OriginalBridge.screenGradient()
    fun heroScrim(): Drawable = V339OriginalBridge.heroScrim()
    fun attachScaleFocus(view: View, scale: Float) = V339OriginalBridge.attachScaleFocus(view, scale)
    fun progressColors(): ColorStateList = V339OriginalBridge.progressColors()
}
