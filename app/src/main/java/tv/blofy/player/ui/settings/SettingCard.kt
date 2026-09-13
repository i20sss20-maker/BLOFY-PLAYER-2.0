package tv.blofy.player.ui.settings

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

/** One focus target with separate, wrapping title/value/description areas. */
internal class SettingCard(context: Context) : LinearLayout(context) {
    private val titleView = label(15f, true)
    private val valueView = label(13f, true).apply { setTextColor(CinemaStyle.Accent) }
    private val hintView = label(11.5f, false).apply { setTextColor(CinemaStyle.Muted) }
    private val indicator = label(16f, true)

    init {
        orientation = VERTICAL
        layoutDirection = resources.configuration.layoutDirection
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        minimumHeight = dp(126)
        isFocusable = true
        isFocusableInTouchMode = DeviceClass.isTv(context)
        isClickable = true
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
        val heading = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        heading.addView(titleView, LayoutParams(0, -2, 1f))
        heading.addView(indicator, LayoutParams(dp(24), -2).apply { marginStart = dp(8) })
        addView(heading, LayoutParams(-1, -2))
        addView(valueView, LayoutParams(-1, -2).apply { topMargin = dp(9) })
        addView(hintView, LayoutParams(-1, -2).apply { topMargin = dp(5) })
        background = CinemaStyle.surface(context, radiusDp = 16)
        setOnFocusChangeListener { _, focused ->
            background = CinemaStyle.surface(context, focused, radiusDp = 16)
            valueView.setTextColor(if (focused) CinemaStyle.White else CinemaStyle.Accent)
            elevation = if (focused) dp(5).toFloat() else 0f
        }
    }

    fun bind(rawTitle: String, value: String, hint: String = "", cycle: Boolean = false) {
        val title = rawTitle.replace(Regex("^[^\\p{L}\\p{N}]+"), "")
        titleView.text = title
        valueView.text = value
        hintView.text = hint
        hintView.visibility = if (hint.isBlank()) GONE else VISIBLE
        indicator.text = if (cycle) "↔" else if (layoutDirection == LAYOUT_DIRECTION_RTL) "‹" else "›"
        contentDescription = listOf(title, value, hint, if (cycle) context.getString(R.string.setting_cycle_hint) else "")
            .filter(String::isNotBlank).joinToString(". ")
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = Button::class.java.name
    }

    private fun label(size: Float, bold: Boolean) = TextView(context).apply {
        textSize = size
        typeface = if (bold) BlofyTvDesign.HeadingTypeface else BlofyTvDesign.BodyTypeface
        setTextColor(CinemaStyle.White)
        gravity = Gravity.START
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
