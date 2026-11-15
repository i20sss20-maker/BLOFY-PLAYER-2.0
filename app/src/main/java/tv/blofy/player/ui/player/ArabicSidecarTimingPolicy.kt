package tv.blofy.player.ui.player

/** Positive delay means the Arabic audio is heard later than the picture.
 * Advance subtracts an earlier delay; a live-only source cannot play future audio.
 */
internal object ArabicSidecarTimingPolicy {
    const val MAX_DELAY_SECONDS = 30
    const val STEP_SECONDS = 1
    const val FAST_FORWARD_RATE = 1.25f

    fun clamp(seconds: Int): Int = seconds.coerceIn(0, MAX_DELAY_SECONDS)

    fun adjust(current: Int, delta: Int): Int =
        (current.toLong() + delta.toLong()).coerceIn(0L, MAX_DELAY_SECONDS.toLong()).toInt()

    fun secondsToCatchUp(current: Int, next: Int): Int =
        (current - next).coerceAtLeast(0)

    /** Playing audio 25% faster clears one buffered second in four seconds. */
    fun catchUpWallTimeMs(seconds: Int): Long =
        (seconds.coerceAtLeast(0) * 1000L * 4).coerceAtMost(120_000L)
}
