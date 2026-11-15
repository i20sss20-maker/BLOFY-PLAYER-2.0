package tv.blofy.player.ui.player

import android.net.NetworkCapabilities
import androidx.media3.common.Player

/** Connectivity hints guide retry eligibility; they do not prove server reachability. */
internal object PlayerNetworkPolicy {
    fun canAttempt(capabilities: NetworkCapabilities?): Boolean =
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

    /** Only restart buffering after a confirmed, sustained offline interval.
     * Routine network validation callbacks must never disrupt a healthy player. */
    fun shouldRetryAfterReconnect(
        hasPlayerError: Boolean, state: Int, offlineDurationMs: Long = 0L
    ): Boolean =
        hasPlayerError || state == Player.STATE_IDLE ||
            (state == Player.STATE_BUFFERING && offlineDurationMs >= 4_000L)
}
