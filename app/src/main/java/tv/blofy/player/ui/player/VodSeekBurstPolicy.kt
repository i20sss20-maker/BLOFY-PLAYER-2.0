package tv.blofy.player.ui.player

/**
 * Coalesces rapid TV remote seeks into one final Media3 seek, instead of
 * opening and aborting a new HTTP Range connection for each D-pad repeat.
 * No URLs, access tokens, subscriber IDs or media data are retained.
 */
internal object VodSeekBurstPolicy {
    const val COMMIT_DELAY_MS = 300L

    fun target(currentPositionMs: Long, pendingPositionMs: Long?, deltaMs: Long, durationMs: Long?): Long {
        val base = (pendingPositionMs ?: currentPositionMs).coerceAtLeast(0L)
        // Saturate instead of overflowing Long for broken duration metadata.
        val moved = when {
            deltaMs > 0 && base > Long.MAX_VALUE - deltaMs -> Long.MAX_VALUE
            deltaMs == Long.MIN_VALUE || deltaMs < 0 && base < -deltaMs -> 0L
            else -> base + deltaMs
        }
        return if (durationMs != null && durationMs > 0L) moved.coerceIn(0L, durationMs)
        else moved.coerceAtLeast(0L)
    }
}
