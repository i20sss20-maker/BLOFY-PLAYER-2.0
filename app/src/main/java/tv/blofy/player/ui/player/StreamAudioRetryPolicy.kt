package tv.blofy.player.ui.player

/** Avoid repeated reconnect loops when a radio upstream briefly sends non-audio bytes. */
internal object StreamAudioRetryPolicy {
    const val RETRY_DELAY_MS = 750L
    private const val MAX_INVALID_AUDIO_RETRIES = 1

    fun shouldRetryInvalidAudio(attemptsAlreadyMade: Int): Boolean =
        attemptsAlreadyMade in 0 until MAX_INVALID_AUDIO_RETRIES
}
