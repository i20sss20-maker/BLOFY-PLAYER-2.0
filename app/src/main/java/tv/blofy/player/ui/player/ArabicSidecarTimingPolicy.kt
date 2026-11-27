package tv.blofy.player.ui.player

/** Positive delay means the Arabic audio is heard later than the picture.
 * Advance subtracts an earlier delay; a live-only source cannot play future audio.
 */
internal object ArabicSidecarTimingPolicy {
    const val MAX_DELAY_SECONDS = 30
    const val MAX_VIDEO_DELAY_SECONDS = 120

    fun videoDelay(seconds: Int): Int = seconds.coerceIn(0, MAX_VIDEO_DELAY_SECONDS)

    /** A seek must remain inside the real DVR window, never invent future media. */
    fun videoSeekTarget(positionMs: Long, liveTargetMs: Long, current: Int, desired: Int): Long? {
        if (positionMs < 0 || liveTargetMs < 0) return null
        val delta = (videoDelay(desired) - videoDelay(current)) * 1000L
        val target = positionMs - delta
        return target.takeIf { it in 0L..maxOf(positionMs, liveTargetMs) }
    }
    const val STEP_SECONDS = 1
    const val FAST_FORWARD_RATE = 1.25f
    const val SLOW_DOWN_RATE = 0.80f

    fun clamp(seconds: Int): Int = seconds.coerceIn(0, MAX_DELAY_SECONDS)

    fun adjust(current: Int, delta: Int): Int =
        (current.toLong() + delta.toLong()).coerceIn(0L, MAX_DELAY_SECONDS.toLong()).toInt()

    /**
     * A non-seekable radio source accumulates one buffered second after
     * five seconds at 0.8x, without interrupting the live voice.
     */
    fun wallTimeToSyncMs(gapMs: Double, rate: Float): Long {
        val driftRate = kotlin.math.abs(1.0 - rate.toDouble())
        if (driftRate < 0.001) return 0L
        return kotlin.math.ceil(kotlin.math.abs(gapMs) / driftRate).toLong()
            .coerceIn(0L, 150_000L)
    }

    fun estimatedOffsetMs(current: Double, elapsedMs: Long, rate: Float): Double =
        (current + elapsedMs.coerceAtLeast(0L) * (1.0 - rate.toDouble()))
            .coerceIn(0.0, MAX_DELAY_SECONDS * 1000.0)

    fun secondsToCatchUp(current: Int, next: Int): Int =
        (current - next).coerceAtLeast(0)

    /** Playing audio 25% faster clears one buffered second in four seconds. */
    fun catchUpWallTimeMs(seconds: Int): Long =
        (seconds.coerceAtLeast(0) * 1000L * 4).coerceAtMost(120_000L)
}
