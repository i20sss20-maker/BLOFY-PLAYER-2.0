package tv.blofy.player.ui.details

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.core.network.awaitResponse
import java.util.concurrent.TimeUnit

/**
 * Authenticated user-opted-in Groq translation for movie/series title/overview.
 * No server credentials, playlist URLs, viewing history, device IDs or external
 * actor metadata are transmitted. Only text currently visible to the subscriber.
 * The secret Groq API key remains in the Railway gateway.
 */
internal object StreamAiTranslationClient {
    data class Translation(val title: String, val overview: String)
    private const val URL = "https://blofy-ai-gateway-production.up.railway.app/v1/translate"
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .callTimeout(16, TimeUnit.SECONDS)
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(13, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .build()

    suspend fun translate(context: Context, title: String, overview: String): Translation? {
        if (!BuildConfig.CODE_ONLY_LOGIN) return null
        val authorization = StreamCodeSession.authorization(context) ?: return null
        val originalTitle = title.trim().take(250)
        val originalOverview = overview.trim().take(3500)
        if (originalTitle.isBlank() && originalOverview.isBlank()) return null
        return withContext(Dispatchers.IO) {
            try {
                val payload = JSONObject()
                    .put("title", originalTitle).put("overview", originalOverview)
                    .put("locale", "ar").toString()
                val request = Request.Builder().url(URL)
                    .post(payload.toRequestBody(jsonType))
                    .header("Authorization", authorization)
                    .header("Accept", "application/json")
                    .header("Cache-Control", "no-store")
                    .build()
                client.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val root = JSONObject(response.body?.string().orEmpty())
                    if (!root.optBoolean("ok")) return@withContext null
                    val newTitle = root.optString("translatedTitle").trim().take(250)
                    val newOverview = root.optString("translatedOverview").trim().take(5500)
                    if (originalTitle.isNotBlank() && newTitle.isBlank()) return@withContext null
                    if (originalOverview.isNotBlank() && newOverview.isBlank()) return@withContext null
                    Translation(newTitle, newOverview)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Failure leaves the original metadata intact and available.
                null
            }
        }
    }
}
