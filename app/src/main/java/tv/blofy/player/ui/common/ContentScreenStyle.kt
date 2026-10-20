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
    fun actionBackground(context: Context, primary: Boolean, focused: Boolean) =
        BlofyUiKit.button(context, primary, focused)

    fun styleAction(button: Button, primary: Boolean = false) {
        BlofyUiKit.styleButton(button, primary)
    }

    fun softSurface(context: Context, focused: Boolean = false, radiusDp: Int = 14) =
        BlofyUiKit.panel(context, focused, radiusDp)

    fun detailsPanel(context: Context) = BlofyUiKit.panel(context, radiusDp = 22)

    fun chip(context: Context) = BlofyUiKit.panel(context, radiusDp = 12)
}
