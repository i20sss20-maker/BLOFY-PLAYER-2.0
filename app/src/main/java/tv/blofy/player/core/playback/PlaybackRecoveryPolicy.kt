package tv.blofy.player.core.playback

/**
 * A source that resumes after a short gap should not trigger an Android TV
 * player reset. Only a sustained live rebuffer qualifies for a bounded retry.
 * Pure logic for JVM tests; timestamps are Android elapsedRealtime() values.
 */
internal object PlaybackRecoveryPolicy {
    const val LIVE_REBUFFER_GRACE_MS = 22_000L
    // The authenticated STREAM gateway can recover the same validated TS
    // socket after its 25s source-idle budget plus a bounded reconnect.
    // Only extend an already-playing code-only LIVE session, never startup.
    const val STREAM_GATEWAY_REBUFFER_GRACE_MS = 58_000L
    const val RECOVERY_COOLDOWN_MS = 60_000L
    const val MAX_RESTARTS_PER_CHANNEL = 3
    const val HEALTHY_PLAYBACK_FOR_RETRY_RESET_MS = 30_000L
    // The source may drop a series/movie response mid-body and omit the strong
    // ETag required for server-side byte stitching. Let Media3 re-open the
    // *same* authenticated URL at its saved play position instead. Never add
    // retries for broken credentials, missing media, codec failures or live TV.
    const val STREAM_VOD_NETWORK_RETRIES = 3

    fun maxErrorRetries(
        isCodeOnlyGateway: Boolean,
        contentKind: String,
        errorCodeName: String,
        httpStatus: Int? = null
    ): Int {
        val isVod = contentKind == "movie" || contentKind == "episode"
        val networkFailure = errorCodeName == "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED" ||
            errorCodeName == "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT"
        val transientHttp = errorCodeName == "ERROR_CODE_IO_BAD_HTTP_STATUS" &&
            httpStatus in setOf(408, 500, 502, 503, 504)
        return if (isCodeOnlyGateway && isVod && (networkFailure || transientHttp))
            STREAM_VOD_NETWORK_RETRIES else 1
    }

    fun errorRetryDelayMs(retry: Int, maxRetries: Int): Long =
        if (maxRetries == STREAM_VOD_NETWORK_RETRIES) when (retry) {
            1 -> 800L
            2 -> 1_600L
            else -> 3_000L
        } else 600L


    fun recoveredLongEnoughToResetErrorRetry(
        lastReadyAtMs: Long,
        nowMs: Long
    ): Boolean = lastReadyAtMs > 0L && nowMs >= lastReadyAtMs &&
        nowMs - lastReadyAtMs >= HEALTHY_PLAYBACK_FOR_RETRY_RESET_MS


    fun liveBufferGraceMs(isCodeOnlyGateway: Boolean, wasReady: Boolean): Long =
        if (isCodeOnlyGateway && wasReady) STREAM_GATEWAY_REBUFFER_GRACE_MS
        else LIVE_REBUFFER_GRACE_MS

    fun shouldRecoverLiveBuffering(
        stalledForMs: Long,
        nowMs: Long,
        lastRecoveryAtMs: Long,
        recoveries: Int,
        graceMs: Long = LIVE_REBUFFER_GRACE_MS
    ): Boolean {
        if (stalledForMs < graceMs || recoveries >= MAX_RESTARTS_PER_CHANNEL) {
            return false
        }
        // 0 is the "no earlier restart" sentinel. A device freshly booted
        // less than one minute ago must not accidentally disable recovery.
        if (lastRecoveryAtMs == 0L) return true
        if (nowMs < lastRecoveryAtMs) return false
        return nowMs - lastRecoveryAtMs >= RECOVERY_COOLDOWN_MS
    }
}
