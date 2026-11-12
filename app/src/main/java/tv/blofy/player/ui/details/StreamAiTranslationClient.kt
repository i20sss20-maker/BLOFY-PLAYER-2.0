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

/** Sends only explicitly opted-in metadata to the first-party GROQ gateway. */
internal object StreamAiTranslationClient {
    data class Translation(val title: String, val overview: String)
    enum class Problem { SESSION, RATE_LIMIT, SERVICE, CONNECTION, INVALID }
    sealed class Outcome {
        data class Ready(val value: Translation) : Outcome()
        data class Unavailable(val reason: Problem) : Outcome()
    }
    private const val URL = "https://blofy-ai-gateway-production.up.railway.app/v1/translate"
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .callTimeout(26, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(23, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .build()

    suspend fun translate(context: Context, title: String, overview: String): Outcome {
        if (!BuildConfig.CODE_ONLY_LOGIN) return Outcome.Unavailable(Problem.SESSION)
        val authorization = StreamCodeSession.authorization(context)
            ?: return Outcome.Unavailable(Problem.SESSION)
        val originalTitle = title.trim().take(250)
        val originalOverview = overview.trim().take(3500)
        if (originalTitle.isBlank() && originalOverview.isBlank())
            return Outcome.Unavailable(Problem.INVALID)
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
                    if (!response.isSuccessful) {
                        return@withContext Outcome.Unavailable(when (response.code) {
                            401, 403 -> Problem.SESSION
                            429 -> Problem.RATE_LIMIT
                            in 500..599 -> Problem.SERVICE
                            else -> Problem.INVALID
                        })
                    }
                    val root = JSONObject(response.body?.string().orEmpty())
                    if (!root.optBoolean("ok")) return@withContext Outcome.Unavailable(Problem.SERVICE)
                    val newTitle = root.optString("translatedTitle").trim().take(250)
                    val newOverview = root.optString("translatedOverview").trim().take(5500)
                    if (originalTitle.isNotBlank() && newTitle.isBlank())
                        return@withContext Outcome.Unavailable(Problem.INVALID)
                    if (originalOverview.isNotBlank() && newOverview.isBlank())
                        return@withContext Outcome.Unavailable(Problem.INVALID)
                    Outcome.Ready(Translation(newTitle, newOverview))
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Keep the source text as-is; never confuse an error with a
                // translation or store malformed text in the local cache.
                Outcome.Unavailable(Problem.CONNECTION)
            }
        }
    }
}
