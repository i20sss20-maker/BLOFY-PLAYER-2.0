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
 * App-side adapter for the reusable first-party BLOFY AI gateway.
 *
 * Only the entered search phrase and language are sent; the subscriber's
 * encrypted session bearer is used solely for server-side verification and is
 * never forwarded to the model. No playlist URLs, Xtream credentials, viewing
 * history, movie library or account profile leave this app.
 *
 * Every result is intersected with the on-device provider catalog by caller.
 */
internal object StreamAiSearchClient {
    data class Intent(
        val kind: String,
        val person: String,
        val genre: String,
        val title: String,
        val year: Int?,
        val suggestedTitles: List<String>
    )

    private const val ENDPOINT =
        "https://blofy-ai-gateway-production.up.railway.app/v1/search/interpret"
    private val client = OkHttpClient.Builder()
        .callTimeout(13, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(11, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false)
        .build()
    private val type = "application/json; charset=utf-8".toMediaType()
    // Session-only phrases, never auth tokens, with fixed 32-entry cap.
    private val cached = object : LinkedHashMap<String, Intent>(32, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Intent>?) = size > 32
    }

    suspend fun interpret(context: Context, phrase: String, locale: String): Intent? {
        if (!BuildConfig.CODE_ONLY_LOGIN || phrase.length !in 3..160) return null
        val access = StreamCodeSession.authorization(context) ?: return null
        val key = locale + ":" + phrase.lowercase()
        synchronized(cached) { cached[key]?.let { return it } }
        return withContext(Dispatchers.IO) {
            try {
                val payload = JSONObject().put("text", phrase).put("locale", locale).toString()
                val request = Request.Builder().url(ENDPOINT)
                    .post(payload.toRequestBody(type))
                    .header("Authorization", access)
                    .header("Accept", "application/json")
                    .header("Cache-Control", "no-store")
                    .build()
                client.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val root = JSONObject(response.body?.string().orEmpty())
                    if (!root.optBoolean("ok")) return@withContext null
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
                        year = year,
                        suggestedTitles = titles.distinct()
                    )
                    synchronized(cached) { cached[key] = output }
                    output
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // AI is optional. Offline search and content playback stay available.
                null
            }
        }
    }
}
