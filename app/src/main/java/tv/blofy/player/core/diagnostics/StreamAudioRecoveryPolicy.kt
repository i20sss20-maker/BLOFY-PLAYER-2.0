package tv.blofy.player.core.diagnostics

/**
 * STREAM-only, non-restarting fallback for the narrow Media3 case where
 * an audio track is supported but no audio track has been selected.
 *
 * This policy never tries to decode an unsupported codec, transcode provider
 * content, override an explicit mute/disabled track, change video quality,
 * reconnect to Xtream or open an additional upstream stream.
 */
object StreamAudioRecoveryPolicy {
    fun shouldAttempt(
        state: StreamAudioHealth.State,
        ready: Boolean,
        volume: Float,
        audioDisabled: Boolean,
        anySelected: Boolean,
        alreadyTried: Boolean
    ): Boolean =
        ready &&
        state == StreamAudioHealth.State.SUPPORTED_NOT_SELECTED &&
        volume > 0f &&
        !audioDisabled &&
        !anySelected &&
        !alreadyTried
}
