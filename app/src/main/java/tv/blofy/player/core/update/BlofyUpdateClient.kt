package tv.blofy.player.core.update

import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class BlofyUpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
    val releaseNotes: String?
)

object BlofyUpdateClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun fetch(baseUrl: String): BlofyUpdateInfo = withContext(Dispatchers.IO) {
        val endpoint = normalizeBaseUrl(baseUrl)
            ?: throw IllegalArgumentException("invalid_update_endpoint")
        val healthUrl = endpoint.newBuilder().addPathSegment("health").build()
        val request = Request.Builder()
            .url(healthUrl)
            .header("Accept", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("update_http_" + response.code)
            val body = response.body?.string().orEmpty()
            parse(body) ?: throw IllegalStateException("invalid_update_metadata")
        }
    }

    fun parse(json: String): BlofyUpdateInfo? = runCatching {
        val root = JsonParser.parseString(json).asJsonObject
        val release = root.getAsJsonObject("release") ?: return@runCatching null
        val app = if (release.has("app") && release.get("app").isJsonObject) release.getAsJsonObject("app") else release
        val code = app.get("versionCode")?.asInt ?: return@runCatching null
        val name = app.get("versionName")?.asString?.trim().orEmpty()
        val url = app.get("downloadUrl")?.asString?.trim().orEmpty()
        val notes = app.get("releaseNotes")?.takeUnless { it.isJsonNull }?.asString?.trim()?.takeIf { it.isNotEmpty() }
        if (code <= 0 || name.isBlank()) return@runCatching null
        val parsedDownload = url.toHttpUrlOrNull() ?: return@runCatching null
        if (!parsedDownload.isHttps) return@runCatching null
        BlofyUpdateInfo(code, name, parsedDownload.toString(), notes)
    }.getOrNull()

    fun isUpdateAvailable(currentVersionCode: Int, info: BlofyUpdateInfo): Boolean =
        info.versionCode > currentVersionCode

    private fun normalizeBaseUrl(value: String) =
        value.trim().trimEnd('/').toHttpUrlOrNull()?.takeIf { it.isHttps && it.username.isEmpty() && it.password.isEmpty() }
}
