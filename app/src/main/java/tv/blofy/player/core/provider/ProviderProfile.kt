package tv.blofy.player.core.provider

data class ProviderProfile(
    val providerKey: String,
    val liveFormat: LiveFormat = LiveFormat.TS,
    val transport: TransportPreference = TransportPreference.CRONET_FIRST,
    val player: PlayerPreference = PlayerPreference.MEDIA3,
    val allowCrossProtocolRedirects: Boolean = true,
    val connectTimeoutMs: Int = 8_000,
    val readTimeoutMs: Int = 15_000,
    val headers: Map<String, String> = emptyMap(),
    val preferDirectSource: Boolean = false,
    val allowHttpFallback: Boolean = true,
    // External playback is an explicit user action from the player controls.
    // Never leave BLOFY automatically after an internal playback failure.
    val allowVlcFallback: Boolean = false,
    val providerKind: ProviderKind = ProviderKind.UNKNOWN
)

enum class LiveFormat(val extension: String) { TS("ts"), HLS("m3u8") }
enum class TransportPreference { CRONET_FIRST, HTTP_FIRST }
enum class PlayerPreference { MEDIA3, VLC }

enum class ProviderKind {
    XTREAM,
    M3U,
    UNKNOWN;

    companion object {
        fun from(value: String?): ProviderKind = when (value?.trim()?.lowercase()) {
            "xtream" -> XTREAM
            "m3u" -> M3U
            else -> UNKNOWN
        }
    }
}
