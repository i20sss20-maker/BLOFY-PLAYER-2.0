package tv.blofy.player.core.device

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

object DeviceClass {
    enum class Kind { TV, TABLET, PHONE }

    fun detect(context: Context): Kind {
        val configuration = context.resources.configuration
        val uiMode = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        val pm = context.packageManager
        val tvUiMode = uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
        val leanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val television = pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION)
        val touchscreen = pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
        val smallest = configuration.smallestScreenWidthDp
        val remoteFirstBox = !touchscreen && smallest >= 480

        return classify(tvUiMode, leanback, television, remoteFirstBox, smallest)
    }

    internal fun classify(
        tvUiMode: Boolean,
        leanback: Boolean,
        television: Boolean,
        remoteFirstBox: Boolean,
        smallestScreenWidthDp: Int,
    ): Kind {
        if (tvUiMode || leanback || television || remoteFirstBox) return Kind.TV
        return if (smallestScreenWidthDp >= 600) Kind.TABLET else Kind.PHONE
    }

    fun isTv(context: Context): Boolean = detect(context) == Kind.TV
}
