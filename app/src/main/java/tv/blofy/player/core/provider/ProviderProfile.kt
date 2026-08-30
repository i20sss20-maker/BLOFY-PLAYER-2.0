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
    val allowHttpFallback: Boolean = true,
    val allowVlcFallback: Boolean = true
)

enum class LiveFormat(val extension: String) { TS("ts"), HLS("m3u8") }
enum class TransportPreference { CRONET_FIRST, HTTP_FIRST }
enum class PlayerPreference { MEDIA3, VLC }
