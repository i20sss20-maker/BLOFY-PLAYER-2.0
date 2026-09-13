package tv.blofy.player.core.playback

/** Do not replace a saved position with the temporary zero of a preparing player. */
class ResumeCheckpoint {
    var positionMs = 0L
        private set
    var durationMs = 0L
        private set
    private var ready = false

    fun reset(position: Long = 0L) {
        positionMs = position.coerceAtLeast(0L)
        durationMs = 0L
        ready = false
    }

    fun sample(position: Long, duration: Long, playbackReady: Boolean): Boolean {
        if (duration > 0L) durationMs = duration
        if (playbackReady) ready = true
        if (!ready || (!playbackReady && position <= 0L)) return false
        positionMs = position.coerceAtLeast(0L)
        return true
    }
}
