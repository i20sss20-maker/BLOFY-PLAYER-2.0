package tv.blofy.player.core.playback

import android.content.Context

/**
 * Compatibility bridge for restored v339 call sites.
 * External playback remains disabled; callers always continue with BLOFY's internal player.
 */
object ExternalPlayerLauncher {
    @Suppress("UNUSED_PARAMETER")
    fun launchPreferred(context: Context, url: String, title: String? = null): Boolean = false

    @Suppress("UNUSED_PARAMETER")
    fun launch(context: Context, url: String, title: String? = null): Boolean = false
}
