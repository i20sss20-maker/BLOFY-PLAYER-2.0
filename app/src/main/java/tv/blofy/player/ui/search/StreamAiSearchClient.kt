package tv.blofy.player.ui.search

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
 * First-party BLOFY AI intent parser. Only the typed search text and locale
 * reach Groq; the temporary subscription bearer is verified at the gateway,
 * never forwarded to the LLM. Android clients contain NO model API keys.
 */
internal object StreamAiSearchClient {
    data class Intent(
        val kind: String, val person: String, val genre: String, val title: String,
        val year: Int?, val suggestedTitles: List<String>
    )
    enum class Problem { NOT_ACTIVATED, EXPIRED_SESSION, RATE_LIMIT, SERVICE, CONNECTION, BAD_RESPONSE }
    sealed class Outcome {
        data class Ready(val intent: Intent, val cached: Boolean = false) : Outcome()
        data class Unavailable(val reason: Problem) : Outcome()
    }

    private const val ENDPOINT =
        "https://blofy-ai-gateway-production.up.railway.app/v1/search/interpret"
    // First-party session verification can take 5.5s and Groq inference can
    // take up to 8.5s. The old 13-second callTimeout killed valid responses.
    private val client = OkHttpClient.Builder()
        .callTimeout(21, TimeUnit.SECONDS)
        .connectTimeout(7, TimeUnit.SECONDS)
        .readTimeout(19, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val cache = object : LinkedHashMap<String, Intent>(32, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Intent>?) = size > 32
    }

    suspend fun lookup(context: Context, phrase: String, locale: String): Outcome {
        val clean = phrase.trim().take(160)
        if (!BuildConfig.CODE_ONLY_LOGIN || clean.length !in 3..160)
            return Outcome.Unavailable(Problem.NOT_ACTIVATED)
        val access = StreamCodeSession.authorization(context)
            ?: return Outcome.Unavailable(Problem.NOT_ACTIVATED)
        val key = access.hashCode().toString() + ":" + locale + ":" + clean.lowercase()
        synchronized(cache) { cache[key]?.let { return Outcome.Ready(it, cached = true) } }
        return withContext(Dispatchers.IO) {
            try {
                val payload = JSONObject().put("text", clean)
                    .put("locale", if (locale == "en") "en" else "ar").toString()
                val request = Request.Builder().url(ENDPOINT)
                    .post(payload.toRequestBody(jsonType))
                    .header("Authorization", access)
                    .header("Accept", "application/json")
                    .header("Cache-Control", "no-store")
                    .build()
                client.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) return@withContext Outcome.Unavailable(when (response.code) {
                        401, 403 -> Problem.EXPIRED_SESSION
                        429 -> Problem.RATE_LIMIT
                        in 500..599 -> Problem.SERVICE
                        else -> Problem.BAD_RESPONSE
                    })
                    val root = JSONObject(response.body?.string().orEmpty())
                    if (!root.optBoolean("ok")) return@withContext Outcome.Unavailable(Problem.BAD_RESPONSE)
                    val suggestions = root.optJSONArray("suggestedTitles")
                    val titles = ArrayList<String>()
                    if (suggestions != null) {
                        for (index in 0 until minOf(suggestions.length(), 12)) {
                            suggestions.optString(index).takeIf { it.length in 3..105 }?.let(titles::add)
                        }
                    }
                    val year = root.optInt("year", 0).takeIf { it in 1900..2035 }
                    val output = Intent(
                        kind = root.optString("intent").take(30),
                        person = root.optString("person").take(90),
                        genre = root.optString("genre").take(35),
                        title = root.optString("title").take(110),
                        year = year, suggestedTitles = titles.distinct()
                    )
                    synchronized(cache) { cache[key] = output }
                    Outcome.Ready(output)
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Outcome.Unavailable(Problem.CONNECTION)
            }
        }
    }
}
