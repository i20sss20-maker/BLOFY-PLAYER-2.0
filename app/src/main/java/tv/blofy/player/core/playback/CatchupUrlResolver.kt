package tv.blofy.player.core.playback

import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object CatchupUrlResolver {
    fun xtream(provider: ProviderEntity, stream: StreamEntity, startMs: Long, endMs: Long): String {
        require(stream.kind == "live") { "Catch-up is only valid for live streams" }
        require(stream.archiveEnabled) { "Provider did not mark this stream as catch-up capable" }
        val durationMinutes = ((endMs - startMs).coerceAtLeast(60_000L) / 60_000L).toInt().coerceAtLeast(1)
        val formatter = SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).apply {
            timeZone = TimeZone.getDefault()
        }
        val start = formatter.format(Date(startMs))
        val base = provider.baseUrl.trim().trimEnd('/')
        return "$base/timeshift/${pathSegment(provider.username)}/${pathSegment(provider.password)}/$durationMinutes/$start/${stream.remoteId}.ts"
    }

    private fun pathSegment(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}
