package tv.blofy.player.ui.player

import android.net.NetworkCapabilities
import androidx.media3.common.Player

/** Connectivity hints guide retry eligibility; they do not prove server reachability. */
internal object PlayerNetworkPolicy {
    fun canAttempt(capabilities: NetworkCapabilities?): Boolean =
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

    /** A buffering player can already be recovering. Do not restart it merely on a network callback. */
    fun shouldRetryAfterReconnect(hasPlayerError: Boolean, state: Int): Boolean =
        hasPlayerError || state == Player.STATE_IDLE
}
