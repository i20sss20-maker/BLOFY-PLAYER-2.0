package tv.blofy.player.core.diagnostics

/**
 * STREAM-only, non-restarting fallback for the narrow Media3 case where
 * an audio track is supported but no supported audio track is selected.
 * A vendor/device may select an unsupported track while exposing an AAC
 * alternative; that case can be recovered unless the viewer chose a track.
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
        alreadyTried: Boolean,
        selectedUnsupported: Boolean = false,
        manualSelection: Boolean = false
    ): Boolean =
        ready &&
        state == StreamAudioHealth.State.SUPPORTED_NOT_SELECTED &&
        volume > 0f &&
        !audioDisabled &&
        !manualSelection &&
        (!anySelected || selectedUnsupported) &&
        !alreadyTried
}
