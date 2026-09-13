package tv.blofy.player.core.identity

import tv.blofy.player.data.local.ActivationEntity

object ActivationLease {
    const val OFFLINE_GRACE_MS = 24L * 60L * 60L * 1000L
    fun allows(state: ActivationEntity, nowMs: Long): Boolean = state.activated &&
        (state.expiresAt == null || state.expiresAt > nowMs) &&
        nowMs - state.lastCheckAt in 0..OFFLINE_GRACE_MS
}
