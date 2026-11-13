package tv.blofy.player.ui.library

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import java.util.concurrent.TimeUnit

/**
 * Optional HEAD-only Content-Length preflight; never downloads media, never
 * follows redirects, never sends a bearer to non-BLOFY hosts.
 * 405/HEAD unsupported => unknown size rather than blocking a valid download.
 */
internal object DownloadFileProbe {
    private val client = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(8, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    suspend fun sizeIfKnown(context: Context, url: String): Long? = withContext(Dispatchers.IO) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) return@withContext null
        runCatching {
            val request = Request.Builder().url(url).head()
                .header("Accept-Encoding", "identity")
            if (BuildConfig.CODE_ONLY_LOGIN &&
                uri.host.equals("blofyplayer.com", true) &&
                uri.path.orEmpty().startsWith("/api/v1/stream/media/")) {
                StreamCodeSession.authorization(context)?.let {
                    request.header("Authorization", it)
                }
            }
            client.newCall(request.build()).execute().use { response ->
                if (response.code != 200 && response.code != 206) return@use null
                response.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0L }
            }
        }.getOrNull()
    }
}
