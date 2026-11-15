package tv.blofy.player.ui.player

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import tv.blofy.player.core.identity.StreamCodeSession
import java.util.concurrent.TimeUnit

/**
 * Code-session-only catalog. Sources are curated by the BLOFY operator, not
 * entered by customers. All playable sidecars must be served via the trusted
 * same-origin authenticated media route; no provider secrets in the app.
 *
 * Expected backend route:
 * GET /api/v1/stream/audio/channels/{channelId}
 * {"tracks":[{"id":"ar-one","label":"Arabic 1","playbackUrl":
 * "https://blofyplayer.com/api/v1/stream/media/audio/asset-id","delaySeconds":0}]}
 */
internal object StreamArabicAudioCatalog {
    data class Track(
        val id: String,
        val label: String,
        val playbackUrl: String,
        val initialDelaySeconds: Int
    )

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .callTimeout(7, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    internal fun trustedAudioUrl(value: String): Boolean {
        val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("blofyplayer.com", ignoreCase = true) &&
            uri.port in listOf(-1, 443) &&
            uri.userInfo == null &&
            uri.path?.startsWith("/api/v1/stream/media/audio/") == true &&
            !uri.path.orEmpty().contains("..") &&
            uri.fragment == null
    }

    suspend fun list(context: Context, channelId: String): List<Track> = withContext(Dispatchers.IO) {
        val id = channelId.trim().take(80)
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return@withContext emptyList()
        val bearer = StreamCodeSession.authorization(context) ?: return@withContext emptyList()
        val url = StreamCodeSession.HOST +
            "/api/v1/stream/audio/channels/" + Uri.encode(id)
        val request = Request.Builder().url(url)
            .header("Authorization", bearer).header("Accept", "application/json")
            .get().build()
        client.newCall(request).execute().use { response ->
            // An absent catalog is optional and cannot interrupt video playback.
            if (response.code == 404 || response.code == 204) return@withContext emptyList()
            if (!response.isSuccessful) return@withContext emptyList()
            val body = response.body ?: return@withContext emptyList()
            if ((body.contentLength() > 65_536) || body.contentLength() < -1) return@withContext emptyList()
            val raw = body.byteStream().use { stream ->
                val bytes = stream.readNBytes(65_537)
                if (bytes.size > 65_536) return@withContext emptyList()
                String(bytes, Charsets.UTF_8)
            }
            decode(raw)
        }
    }

    internal fun decode(raw: String): List<Track> {
        val rows = runCatching { JSONObject(raw).optJSONArray("tracks") }.getOrNull()
            ?: return emptyList()
        val items = mutableListOf<Track>()
        for (i in 0 until minOf(rows.length(), 20)) {
            val row = rows.optJSONObject(i) ?: continue
            val id = row.optString("id", "").take(64)
            val label = row.optString("label", "").trim().take(80)
            val url = row.optString("playbackUrl", "")
            if (!id.matches(Regex("[A-Za-z0-9_-]{1,64}")) ||
                label.isBlank() || !trustedAudioUrl(url)) continue
            items += Track(
                id, label, url,
                ArabicSidecarTimingPolicy.clamp(row.optInt("delaySeconds", 0))
            )
            if (items.size == 8) break
        }
        return items.distinctBy { it.id }
    }
}
