package tv.blofy.player.core.diagnostics

/**
 * Explicitly copied, privacy-scoped owner troubleshooting snapshot.
 * No automatic upload, analytics event, URL, channel ID, device ID, session,
 * account, provider hostname, or exception payload is accepted or stored.
 */
internal object StreamAudioQaReport {
    fun create(
        sdk: Int,
        playbackState: Int,
        audio: StreamAudioHealth.Summary,
        evidence: StreamAudioOutputEvidence
    ): String {
        val safeMime = audio.selectedMimeType
            ?.take(48)
            ?.takeIf { it.matches(Regex("^[A-Za-z0-9._/+-]+$")) }
            ?: "unknown"
        val state = when (playbackState) {
            1 -> "idle"
            2 -> "buffering"
            3 -> "ready"
            4 -> "ended"
            else -> "unknown"
        }
        fun capped(n: Int): Int = n.coerceIn(0, 50)
        return listOf(
            "BLOFY_STREAM_AUDIO_QA_V1",
            "android_sdk=${sdk.takeIf { it in 21..50 } ?: 0}",
            "playback_state=$state",
            "audio_state=${audio.state.name}",
            "audio_total=${capped(audio.available)}",
            "audio_supported=${capped(audio.supported)}",
            "audio_selected=${capped(audio.selected)}",
            "audio_mime=$safeMime",
            evidence.safeCode(),
            "audible_sound=not_verified"
        ).joinToString("\n")
    }
}
