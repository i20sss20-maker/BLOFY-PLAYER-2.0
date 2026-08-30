package tv.blofy.player.core.playback

import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object CatchupUrlBuilder {
    fun xtream(provider: ProviderEntity, stream: StreamEntity, startMs: Long, endMs: Long): String {
        require(!provider.providerType.equals("m3u", true)) { "Catch-up URL builder requires Xtream provider" }
        require(startMs > 0L && endMs > startMs) { "Invalid catch-up window" }
        val durationMinutes = ((endMs - startMs + 59_999L) / 60_000L).coerceAtLeast(1L)
        val formatter = SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).apply {
            timeZone = TimeZone.getDefault()
        }
        val start = formatter.format(Date(startMs))
        return "${provider.baseUrl.trim().trimEnd('/')}/timeshift/${provider.username}/${provider.password}/$durationMinutes/$start/${stream.remoteId}.ts"
    }
}
