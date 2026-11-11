package tv.blofy.player.core.playback

import androidx.media3.common.PlaybackException

/**
 * Final-stage recovery after Media3's own load-error policy has run.
 *
 * Terminal/authorization errors should never be retried on the same URL.
 * Brief network/server failures get one small, bounded backoff before the
 * player's existing configured-origin and alternate-format failovers.
 *
 * Keep this logic independent of URLs, credentials and Android device IDs.
 */
internal object PlaybackRecoveryPolicy {
    private const val BASE_NETWORK_DELAY_MS = 550L
    private const val BASE_SERVER_DELAY_MS = 900L
    private const val MAX_DELAY_MS = 2_000L
    private const val MAX_REPEATED_ERRORS_PER_WINDOW = 4
    const val ERROR_WINDOW_MS = 60_000L

    fun delayForSameUrlRetry(
        playbackErrorCode: Int,
        httpStatus: Int?,
        attempt: Int,
        recentFailures: Int
    ): Long? {
        if (attempt !in 0..1 || recentFailures > MAX_REPEATED_ERRORS_PER_WINDOW) return null
        // Never hammer missing episodes or 401/403 subscription errors.
        if (httpStatus != null) {
            if (httpStatus in 400..428 || httpStatus in 430..499) return null
            if (httpStatus == 429 || httpStatus in 500..599) {
                val base = if (httpStatus == 429) 1_500L else BASE_SERVER_DELAY_MS
                return (base * (attempt + 1)).coerceAtMost(MAX_DELAY_MS)
            }
            if (httpStatus in 200..399) return null
        }
        return when (playbackErrorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
            PlaybackException.ERROR_CODE_TIMEOUT -> (BASE_NETWORK_DELAY_MS * (attempt + 1))
                .coerceAtMost(MAX_DELAY_MS)
            else -> null
        }
    }

    fun failureWindowCount(nowMs: Long, windowStartedAtMs: Long, current: Int): Pair<Long, Int> =
        if (windowStartedAtMs == 0L || nowMs < windowStartedAtMs ||
            nowMs - windowStartedAtMs >= ERROR_WINDOW_MS
        ) nowMs to 1 else windowStartedAtMs to (current + 1)
}
