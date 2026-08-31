package tv.blofy.player.core.device

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration

object DeviceClass {
    enum class Kind { TV, TABLET, PHONE }

    fun detect(context: Context): Kind {
        val uiMode = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return Kind.TV
        val smallest = context.resources.configuration.smallestScreenWidthDp
        return if (smallest >= 600) Kind.TABLET else Kind.PHONE
    }

    fun isTv(context: Context): Boolean = detect(context) == Kind.TV
}
