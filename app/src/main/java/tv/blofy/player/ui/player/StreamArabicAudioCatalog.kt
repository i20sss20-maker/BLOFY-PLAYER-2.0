package tv.blofy.player.ui.player

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * BLOFY STREAM's in-application Arabic audio library. The bundled catalog
 * ships with the STREAM APK; it does not depend on an admin page or on a new
 * activation-server API. A file selected from Android's document picker is
 * used on that device only, without uploading it or changing the code login.
 *
 * Operator catalog in app/src/main/assets/blofy_stream_audio_catalog.json:
 * {"channels":[{"channelId":"123","tracks":[
 * {"id":"voice-ar","label":"التعليق العربي","playbackUrl":"https://...",
 * "delaySeconds":2,"format":"hls"}]}]}
 */
internal object StreamArabicAudioCatalog {
    private const val MAX_JSON_BYTES = 262_144
    private val channelIdFormat = Regex("[A-Za-z0-9_-]{1,80}")
    private val trackIdFormat = Regex("[A-Za-z0-9_-]{1,64}")

    data class Track(
        val id: String,
        val label: String,
        val playbackUrl: String,
        val initialDelaySeconds: Int,
        val format: String
    )

    /** Same-origin bearer authorization is allowed for this route ONLY. */
    internal fun trustedAudioUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("blofyplayer.com", ignoreCase = true) &&
            uri.port in listOf(-1, 443) &&
            !uri.encodedAuthority.orEmpty().contains('@') &&
            uri.path?.startsWith("/api/v1/stream/media/audio/") == true &&
            !uri.path.orEmpty().contains("..") &&
            uri.fragment == null
    }

    /**
     * A user-selected audio playlist may point outside BLOFY. Such requests
     * must use a separate unauthenticated HTTP transport; never attach the
     * STREAM activation bearer to them. Restrict these to public HTTPS hosts.
     */
    internal fun publicAudioUrl(value: String): Boolean {
        if (value.length !in 12..1600 || value.any { it.isWhitespace() || it.code < 32 || it.code == 127 })
            return false
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        if (!uri.scheme.equals("https", true) || uri.port !in listOf(-1, 443) ||
            uri.fragment != null || uri.encodedAuthority.orEmpty().contains('@') ||
            !host.contains('.') || !host.matches(Regex("[a-z0-9.-]{4,253}")) ||
            host.startsWith('.') || host.endsWith('.') || host.contains(".."))
            return false
        if (host == "localhost" || host.endsWith(".localhost") ||
            host.endsWith(".local") || host.endsWith(".internal") ||
            host.matches(Regex("[0-9.]+")) ||
            host.startsWith("10.") || host.startsWith("127.") ||
            host.startsWith("192.168.") || host.startsWith("169.254."))
            return false
        return true
    }

    internal fun playableUrl(value: String): Boolean =
        trustedAudioUrl(value) || publicAudioUrl(value)

    /** The embedded catalog has channel assignments and travels in the APK. */
    suspend fun list(context: Context, channelId: String): List<Track> = withContext(Dispatchers.IO) {
        if (!channelIdFormat.matches(channelId)) return@withContext emptyList()
        val raw = runCatching {
            context.assets.open("blofy_stream_audio_catalog.json").use { source ->
                val output = java.io.ByteArrayOutputStream()
                val block = ByteArray(4096)
                while (output.size() <= MAX_JSON_BYTES) {
                    val n = source.read(block)
                    if (n == -1) break
                    output.write(block, 0, n)
                }
                if (output.size() > MAX_JSON_BYTES) "" else output.toString(Charsets.UTF_8.name())
            }
        }.getOrDefault("")
        decodeForChannel(raw, channelId)
    }

    internal fun decodeForChannel(raw: String, channelId: String): List<Track> {
        if (!channelIdFormat.matches(channelId)) return emptyList()
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyList()
        val channels = root.optJSONArray("channels") ?: return emptyList()
        for (i in 0 until minOf(channels.length(), 256)) {
            val entry = channels.optJSONObject(i) ?: continue
            if (entry.optString("channelId") == channelId) return decodeTracks(entry)
        }
        return emptyList()
    }

    /** Backwards-compatible decoder used in the existing Android QA tests. */
    internal fun decode(raw: String): List<Track> {
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyList()
        return decodeTracks(root)
    }

    private fun decodeTracks(root: JSONObject): List<Track> {
        val rows = root.optJSONArray("tracks") ?: return emptyList()
        val tracks = mutableListOf<Track>()
        for (i in 0 until minOf(rows.length(), 64)) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id", "").trim().take(64)
            val label = row.optString("label", "").trim().take(80)
            val url = row.optString("playbackUrl", "")
            if (!trackIdFormat.matches(id) || label.isBlank() || !playableUrl(url)) continue
            val format = if (row.optString("format", "").equals("hls", true) ||
                Uri.parse(url).path.orEmpty().endsWith(".m3u8", true)) "hls" else "progressive"
            tracks += Track(id, label, url,
                ArabicSidecarTimingPolicy.clamp(row.optInt("delaySeconds", 0)), format)
            if (tracks.size == 8) break
        }
        return tracks.distinctBy { it.id }
    }
}
