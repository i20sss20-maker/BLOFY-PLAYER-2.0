package tv.blofy.player.ui.player

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.core.identity.StreamCodeSession
import java.util.concurrent.TimeUnit

/**
 * BLOFY STREAM Arabic audio appears INSIDE the channel player. Only the
 * existing code-session bearer can retrieve source names and play audio,
 * through our first-party authenticated HTTPS proxy. No external audio
 * provider token, raw M3U URL or Xtream credentials is bundled in the APK.
 * The optional local-only file parser remains available for dev QA but is
 * NOT exposed to subscriber UI in this curated-audio release.
 */
internal object StreamArabicAudioCatalog {
    private const val MAX_JSON_BYTES = 262_144
    private val channelIdFormat = Regex("[A-Za-z0-9_-]{1,80}")
    private val trackIdFormat = Regex("[A-Za-z0-9_-]{1,64}")
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(7, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false)
            .build()
    }

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

    /**
     * The channel video remains unchanged while the viewer chooses a separate
     * voice from the built-in BLOFY audio menu. All 38 curated voice choices
     * are provided securely by the current BLOFY server session, not a
     * third-party file picker or a customer-entered URL.
     */
    internal enum class Failure {
        NONE, INVALID_CHANNEL, NOT_ACTIVATED, UNAUTHORIZED, NO_ENDPOINT,
        RATE_LIMITED, SERVICE, EMPTY_CATALOG, NETWORK
    }

    internal data class Lookup(val tracks: List<Track>, val failure: Failure)

    /** UI needs to distinguish missing backend endpoint from unavailable
     * commentary, otherwise customers see misleading "not available yet".
     * Preserve the original protected bearer route; never use public HTTP
     * endpoints or leak operator source URLs into application logs.
     */
    suspend fun lookup(context: Context, channelId: String): Lookup =
        withContext(Dispatchers.IO) {
            if (!channelIdFormat.matches(channelId))
                return@withContext Lookup(emptyList(), Failure.INVALID_CHANNEL)
            val bearer = StreamCodeSession.authorization(context)
                ?: return@withContext Lookup(emptyList(), Failure.NOT_ACTIVATED)
            runCatching {
                val request = Request.Builder()
                    .url(StreamCodeSession.HOST + "/api/v1/stream/audio/catalog")
                    .header("Authorization", bearer)
                    .header("Accept", "application/json").get().build()
                client.newCall(request).execute().use { response ->
                    val reason = when (response.code) {
                        401, 403 -> Failure.UNAUTHORIZED
                        404 -> Failure.NO_ENDPOINT
                        429 -> Failure.RATE_LIMITED
                        in 500..599 -> Failure.SERVICE
                        else -> Failure.NETWORK
                    }
                    if (!response.isSuccessful) return@use Lookup(emptyList(), reason)
                    if ((response.body?.contentLength() ?: 0) > MAX_JSON_BYTES)
                        return@use Lookup(emptyList(), Failure.EMPTY_CATALOG)
                    val input = response.body?.byteStream()
                        ?: return@use Lookup(emptyList(), Failure.EMPTY_CATALOG)
                    val raw = input.use { stream ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (output.size() <= MAX_JSON_BYTES) {
                            val n = stream.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                        }
                        if (output.size() > MAX_JSON_BYTES) ""
                        else output.toString(Charsets.UTF_8.name())
                    }
                    val source = runCatching { JSONObject(raw) }.getOrNull()
                    val tracks = (if (source?.has("channels") == true)
                        decodeForChannel(raw, channelId)
                    else decode(raw)).filter { trustedAudioUrl(it.playbackUrl) }
                    Lookup(tracks, if (tracks.isEmpty()) Failure.EMPTY_CATALOG else Failure.NONE)
                }
            }.getOrElse { Lookup(emptyList(), Failure.NETWORK) }
        }

    suspend fun list(context: Context, channelId: String): List<Track> =
        lookup(context, channelId).tracks

    internal fun groupName(track: Track, english: Boolean): String {
        val id = track.id
        val group = when {
            id.startsWith("anis-max-low-") -> "max-low"
            id.startsWith("anis-max-") -> "max"
            id.startsWith("anis-sport-") -> "sport"
            id.startsWith("anis-italy-") -> "italy"
            id.startsWith("anis-de-") -> "de"
            id.startsWith("anis-thm8h-") -> "thm8h"
            id.startsWith("anis-shasha") -> "shasha"
            id.startsWith("anis-shahid") -> "shahid"
            id.startsWith("anis-en-") -> "en"
            id.startsWith("anis-fr-") -> "fr"
            id.startsWith("anis-xtra-") -> "xtra"
            id.startsWith("anis-alkass-") -> "alkass"
            else -> "other"
        }
        val en = mapOf("max" to "BLOFY Max", "sport" to "BLOFY Sport",
            "italy" to "BLOFY Italy", "de" to "BLOFY DE", "thm8h" to "BLOFY Thm8h",
            "shasha" to "BLOFY Shasha", "shahid" to "BLOFY Shahid",
            "en" to "BLOFY EN", "fr" to "BLOFY FR", "xtra" to "BLOFY Xtra",
            "alkass" to "BLOFY Al Kass", "max-low" to "BLOFY Max Low",
            "other" to "Other audio")
        val ar = mapOf("max" to "بلوفي ماكس", "sport" to "بلوفي سبورت",
            "italy" to "بلوفي إيطاليا", "de" to "بلوفي ألمانيا",
            "thm8h" to "بلوفي السعودية", "shasha" to "بلوفي شاشة",
            "shahid" to "بلوفي شاهد", "en" to "بلوفي الإنجليزية",
            "fr" to "بلوفي الفرنسية", "xtra" to "بلوفي إكسترا",
            "alkass" to "بلوفي الكأس", "max-low" to "بلوفي ماكس منخفض",
            "other" to "صوتيات أخرى")
        return (if (english) en else ar).getValue(group)
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
            // Rebrand only the UI label; preserve upstream track IDs and playback URLs.
            val label = row.optString("label", "").trim().take(80)
                .replace(Regex("(?i)\\b(?:anes|anis)\\b"), "BLOFY")
                .replace("أنيس", "بلوفي")
            val url = row.optString("playbackUrl", "")
            if (!trackIdFormat.matches(id) || label.isBlank() || !playableUrl(url)) continue
            val format = if (row.optString("format", "").equals("hls", true) ||
                Uri.parse(url).path.orEmpty().endsWith(".m3u8", true)) "hls" else "progressive"
            tracks += Track(id, label, url,
                ArabicSidecarTimingPolicy.clamp(row.optInt("delaySeconds", 0)), format)
            if (tracks.size == 60) break
        }
        return tracks.distinctBy { it.id }
    }
}
