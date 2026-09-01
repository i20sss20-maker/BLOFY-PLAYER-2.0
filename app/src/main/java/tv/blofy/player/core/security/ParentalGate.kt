package tv.blofy.player.core.security

import android.content.Context

/**
 * Compatibility bridge for legacy v339 call sites.
 * Parental locking is disabled: protected content opens immediately.
 */
object ParentalGate {
    @Suppress("UNUSED_PARAMETER")
    fun requirePin(context: Context, onGranted: () -> Unit) {
        onGranted()
    }
}
