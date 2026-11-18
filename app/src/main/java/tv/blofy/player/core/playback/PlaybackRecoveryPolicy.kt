package tv.blofy.player.core.playback

/**
 * A source that resumes after a short gap should not trigger an Android TV
 * player reset. Only a sustained live rebuffer qualifies for a bounded retry.
 * Pure logic for JVM tests; timestamps are Android elapsedRealtime() values.
 */
internal object PlaybackRecoveryPolicy {
    const val LIVE_REBUFFER_GRACE_MS = 22_000L
    const val RECOVERY_COOLDOWN_MS = 60_000L
    const val MAX_RESTARTS_PER_CHANNEL = 3

    fun shouldRecoverLiveBuffering(
        stalledForMs: Long,
        nowMs: Long,
        lastRecoveryAtMs: Long,
        recoveries: Int
    ): Boolean {
        if (stalledForMs < LIVE_REBUFFER_GRACE_MS || recoveries >= MAX_RESTARTS_PER_CHANNEL) {
            return false
        }
        // 0 is the "no earlier restart" sentinel. A device freshly booted
        // less than one minute ago must not accidentally disable recovery.
        if (lastRecoveryAtMs == 0L) return true
        if (nowMs < lastRecoveryAtMs) return false
        return nowMs - lastRecoveryAtMs >= RECOVERY_COOLDOWN_MS
    }
}
