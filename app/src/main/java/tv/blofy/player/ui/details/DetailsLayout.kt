package tv.blofy.player.ui.details

import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.doOnLayout
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.ui.common.CinemaStyle

/** Touch screens keep the primary action outside the scrolling synopsis. */
internal class DetailsLayout(private val activity: AppCompatActivity) {
    val isTv = DeviceClass.isTv(activity)
    private val stacked = !isTv && activity.resources.configuration.screenWidthDp < 600
    val root = FrameLayout(activity).apply { setBackgroundColor(CinemaStyle.Background) }
    val backdrop = ImageView(activity).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        alpha = .55f
    }
    val poster = ImageView(activity).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundColor(CinemaStyle.Surface)
    }
    val info = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        gravity = (if (isTv) Gravity.CENTER_VERTICAL else Gravity.TOP) or Gravity.END
        layoutDirection = activity.resources.configuration.layoutDirection
        setPadding(dp(if (isTv) 12 else 0), dp(if (isTv) 28 else 8), dp(if (isTv) 12 else 0), dp(if (isTv) 28 else 24))
    }
    private val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val profileActions = LinearLayout(activity).apply { tag = "blofy_details_profile_actions" }

    init {
        root.addView(backdrop, FrameLayout.LayoutParams(-1, -1))
        root.addView(View(activity).apply {
            background = GradientDrawable(
                if (stacked) GradientDrawable.Orientation.TOP_BOTTOM else GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xC0211237.toInt(), 0xE8211237.toInt(), 0xFA170D29.toInt())
            )
        }, FrameLayout.LayoutParams(-1, -1))
        val body = LinearLayout(activity).apply {
            orientation = if (stacked) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            layoutDirection = activity.resources.configuration.layoutDirection
            gravity = if (isTv) Gravity.CENTER_VERTICAL else Gravity.TOP
            setPadding(dp(if (isTv) 48 else 20), dp(if (isTv) 24 else 16), dp(if (isTv) 48 else 20), dp(if (isTv) 24 else 16))
        }
        val posterHeight = if (isTv) (activity.resources.configuration.screenHeightDp * .72f).toInt().coerceIn(260, 500) else if (stacked) 188 else 210
        val posterWidth = if (isTv) posterHeight * 2 / 3 else if (stacked) 128 else 142
        val card = FrameLayout(activity).apply {
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = CinemaStyle.surface(activity, radiusDp = 12)
            addView(poster, FrameLayout.LayoutParams(-1, -1))
        }
        body.addView(card, LinearLayout.LayoutParams(dp(posterWidth), dp(posterHeight)).apply {
            gravity = if (stacked) Gravity.CENTER_HORIZONTAL else if (isTv) Gravity.CENTER_VERTICAL else Gravity.TOP
            marginEnd = if (stacked) 0 else dp(if (isTv) 34 else 20)
            bottomMargin = if (stacked) dp(12) else 0
        })
        if (isTv) {
            val scroll = scrollView().apply {
                addView(info, FrameLayout.LayoutParams(-1, -2))
                doOnLayout { info.minimumHeight = height }
            }
            body.addView(scroll, LinearLayout.LayoutParams(0, -1, 1f))
            root.addView(body, FrameLayout.LayoutParams(-1, -1))
        } else {
            body.addView(info, if (stacked) LinearLayout.LayoutParams(-1, -2) else LinearLayout.LayoutParams(0, -2, 1f))
            val scroll = scrollView().apply { addView(body, FrameLayout.LayoutParams(-1, -2)) }
            content.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
            root.addView(content, FrameLayout.LayoutParams(-1, -1))
            WindowCompat.setDecorFitsSystemWindows(activity.window, false)
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
                val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
                insets
            }
        }
        activity.setContentView(root)
        if (!isTv) root.addView(profileActions, FrameLayout.LayoutParams(0, 0))
        ViewCompat.requestApplyInsets(content)
    }

    fun attachActions(row: LinearLayout) {
        if (isTv) {
            info.addView(CinemaStyle.actionStrip(activity, row))
            return
        }
        val primary = row.getChildAt(0)
        row.removeView(primary)
        root.removeView(profileActions)
        row.addView(profileActions, LinearLayout.LayoutParams(-2, dp(48)))
        val dock = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = activity.resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(10))
            setBackgroundColor(CinemaStyle.Background)
        }
        dock.addView(primary, LinearLayout.LayoutParams(dp(148), dp(48)).apply { marginEnd = dp(8) })
        for (index in 0 until row.childCount) {
            row.getChildAt(index).layoutParams = (row.getChildAt(index).layoutParams as LinearLayout.LayoutParams).apply { height = dp(48) }
        }
        dock.addView(CinemaStyle.actionStrip(activity, row).apply {
            isHorizontalScrollBarEnabled = true
        }, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(dock, LinearLayout.LayoutParams(-1, -2))
    }

    fun logoParams() = LinearLayout.LayoutParams(if (isTv) dp(390) else -1, dp(if (isTv) 86 else 64)).apply {
        gravity = Gravity.END
        topMargin = dp(4)
    }

    private fun scrollView() = ScrollView(activity).apply {
        isFillViewport = true
        isVerticalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        clipToPadding = false
    }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
}
