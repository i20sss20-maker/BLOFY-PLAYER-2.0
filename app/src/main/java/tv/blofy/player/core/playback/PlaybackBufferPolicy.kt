package tv.blofy.player.core.playback

/**
 * Playback buffers tuned for lower-memory Android TV boxes.
 *
 * Live: hold a short, bounded amount of media so an upstream TS reconnect does
 * not necessarily force a decoder reset. VOD: keep more room for normal seeks
 * and source read jitter without allocating an unbounded video cache.
 *
 * These values are Media3 milliseconds / bytes; no disk writes or new URL
 * requests are introduced by this policy.
 */
internal data class PlaybackBufferBudget(
    val minBufferMs: Int,
    val maxBufferMs: Int,
    val playbackStartMs: Int,
    val afterRebufferMs: Int,
    val maxBufferBytes: Int
) {
    init {
        require(minBufferMs > 0)
        require(maxBufferMs >= minBufferMs)
        require(playbackStartMs >= 0 && playbackStartMs <= minBufferMs)
        require(afterRebufferMs >= playbackStartMs && afterRebufferMs <= minBufferMs)
        require(maxBufferBytes in 4 * 1024 * 1024..32 * 1024 * 1024)
    }
}

internal object PlaybackBufferPolicy {
    fun forKind(contentKind: String): PlaybackBufferBudget = when (contentKind) {
        "live", "live_preview" -> PlaybackBufferBudget(
            minBufferMs = 8_000,
            maxBufferMs = 22_000,
            playbackStartMs = 800,
            afterRebufferMs = 1_800,
            maxBufferBytes = 16 * 1024 * 1024
        )
        else -> PlaybackBufferBudget(
            minBufferMs = 12_000,
            maxBufferMs = 40_000,
            playbackStartMs = 1_000,
            afterRebufferMs = 2_200,
            maxBufferBytes = 24 * 1024 * 1024
        )
    }
}
