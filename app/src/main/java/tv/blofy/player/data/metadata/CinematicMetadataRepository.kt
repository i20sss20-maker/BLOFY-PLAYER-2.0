package tv.blofy.player.data.metadata

import android.content.Context
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.BuildConfig
import java.util.concurrent.TimeUnit

/** Optional TMDb enrichment. Playback/catalog behavior never depends on this repository. */
object CinematicMetadataRepository {
    private const val PREFS = "blofy_cinematic_metadata"
    private const val TTL_MS = 7L * 24L * 60L * 60L * 1000L
    private const val IMAGE_BASE = "https://image.tmdb.org/t/p/"
    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(7, TimeUnit.SECONDS)
        .build()

    data class Person(
        val id: Int,
        val name: String,
        val character: String?,
        val profileUrl: String?
    )

    data class Credit(
        val name: String,
        val job: String
    )

    data class Metadata(
        val tmdbId: Int,
        val kind: String,
        val title: String,
        val overview: String?,
        val rating: Double?,
        val voteCount: Int,
        val releaseDate: String?,
        val runtimeMinutes: Int?,
        val genres: List<String>,
        val posterUrl: String?,
        val backdropUrl: String?,
        val logoUrl: String?,
        val cast: List<Person>,
        val crew: List<Credit>,
        val fetchedAt: Long = System.currentTimeMillis()
    )

    data class PersonWorks(
        val personName: String,
        val profileUrl: String?,
        val titles: List<String>
    )

    suspend fun movie(context: Context, title: String, year: String?): Metadata? = load(context, "movie", title, year)
    suspend fun series(context: Context, title: String, year: String?): Metadata? = load(context, "tv", title, year)

    suspend fun personWorks(query: String): PersonWorks? {
        val token = BuildConfig.TMDB_TOKEN.trim()
        if (token.isBlank() || query.trim().length < 2) return null
        return runCatching { fetchPersonWorks(query.trim(), token) }.getOrNull()
    }

    suspend fun recommendations(metadata: Metadata): List<String> {
        val token = BuildConfig.TMDB_TOKEN.trim()
        if (token.isBlank()) return emptyList()
        return runCatching { fetchRecommendations(metadata.kind, metadata.tmdbId, token) }.getOrDefault(emptyList())
    }

    private fun cacheKey(kind: String, title: String, year: String?) =
        "$kind:${title.trim().lowercase()}:${year.orEmpty().trim()}"

    private suspend fun load(context: Context, kind: String, title: String, year: String?): Metadata? {
        val key = cacheKey(kind, title, year)
        readCache(context, key)?.let { if (System.currentTimeMillis() - it.fetchedAt < TTL_MS) return it }
        val token = BuildConfig.TMDB_TOKEN.trim()
        if (token.isBlank()) return readCache(context, key)
        val result = runCatching { fetch(kind, title, year, token) }.getOrNull() ?: return readCache(context, key)
        writeCache(context, key, result)
        return result
    }

    private fun fetch(kind: String, rawTitle: String, year: String?, token: String): Metadata? {
        val title = cleanTitle(rawTitle)
        val searchUrl = "https://api.themoviedb.org/3/search/$kind".toHttpUrl().newBuilder()
            .addQueryParameter("query", title)
            .addQueryParameter("language", "ar-SA")
            .addQueryParameter("include_adult", "false")
            .apply {
                year?.trim()?.takeIf { it.length == 4 && it.all(Char::isDigit) }?.let {
                    addQueryParameter(if (kind == "movie") "year" else "first_air_date_year", it)
                }
            }.build()
        val search = get<SearchResponse>(searchUrl.toString(), token) ?: return null
        val best = search.results.firstOrNull() ?: return null
        val detailUrl = "https://api.themoviedb.org/3/$kind/${best.id}".toHttpUrl().newBuilder()
            .addQueryParameter("language", "ar-SA")
            .addQueryParameter("append_to_response", "credits,images")
            .addQueryParameter("include_image_language", "ar,en,null")
            .build()
        val detail = get<DetailResponse>(detailUrl.toString(), token) ?: return null
        val cast = detail.credits?.cast.orEmpty().take(12).map {
            Person(it.id, it.name, it.character, image(it.profilePath, "w185"))
        }
        val crew = detail.credits?.crew.orEmpty()
            .filter { it.job.equals("Director", true) || it.job.equals("Writer", true) || it.job.equals("Screenplay", true) || it.job.equals("Creator", true) }
            .distinctBy { it.name to it.job }
            .take(6)
            .map { Credit(it.name, localizeJob(it.job)) }
        val logo = detail.images?.logos.orEmpty().firstOrNull()?.filePath
        val runtime = detail.runtime ?: detail.episodeRunTime?.firstOrNull()
        return Metadata(
            tmdbId = detail.id,
            kind = kind,
            title = detail.title ?: detail.name ?: rawTitle,
            overview = detail.overview?.takeIf(String::isNotBlank),
            rating = detail.voteAverage.takeIf { it > 0.0 },
            voteCount = detail.voteCount,
            releaseDate = detail.releaseDate ?: detail.firstAirDate,
            runtimeMinutes = runtime,
            genres = detail.genres.orEmpty().mapNotNull { it.name?.takeIf(String::isNotBlank) },
            posterUrl = image(detail.posterPath, "w500"),
            backdropUrl = image(detail.backdropPath, "w1280"),
            logoUrl = image(logo, "w500"),
            cast = cast,
            crew = crew
        )
    }

    private fun fetchPersonWorks(query: String, token: String): PersonWorks? {
        val searchUrl = "https://api.themoviedb.org/3/search/person".toHttpUrl().newBuilder()
            .addQueryParameter("query", query)
            .addQueryParameter("language", "ar-SA")
            .addQueryParameter("include_adult", "false")
            .build()
        val search = get<PersonSearchResponse>(searchUrl.toString(), token) ?: return null
        val person = search.results.firstOrNull() ?: return null
        val creditsUrl = "https://api.themoviedb.org/3/person/${person.id}/combined_credits".toHttpUrl().newBuilder()
            .addQueryParameter("language", "ar-SA")
            .build()
        val credits = get<CombinedCreditsResponse>(creditsUrl.toString(), token) ?: return null
        val titles = credits.cast
            .sortedWith(compareByDescending<CombinedCreditItem> { it.voteCount }.thenByDescending { it.popularity })
            .mapNotNull { (it.title ?: it.name)?.takeIf(String::isNotBlank) }
            .distinct()
            .take(18)
        return PersonWorks(person.name, image(person.profilePath, "w185"), titles)
    }

    private fun fetchRecommendations(kind: String, tmdbId: Int, token: String): List<String> {
        val url = "https://api.themoviedb.org/3/$kind/$tmdbId/recommendations".toHttpUrl().newBuilder()
            .addQueryParameter("language", "ar-SA")
            .build()
        val response = get<RecommendationResponse>(url.toString(), token) ?: return emptyList()
        return response.results
            .mapNotNull { (it.title ?: it.name)?.takeIf(String::isNotBlank) }
            .distinct()
            .take(14)
    }

    private inline fun <reified T> get(url: String, token: String): T? {
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").header("Accept", "application/json").build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            return gson.fromJson(body, T::class.java)
        }
    }

    private fun readCache(context: Context, key: String): Metadata? {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null) ?: return null
        return runCatching { gson.fromJson(raw, Metadata::class.java) }.getOrNull()
    }

    private fun writeCache(context: Context, key: String, value: Metadata) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, gson.toJson(value)).apply()
    }

    private fun image(path: String?, size: String): String? = path?.takeIf(String::isNotBlank)?.let { IMAGE_BASE + size + it }

    private fun cleanTitle(value: String): String = value
        .replace(Regex("(?i)\\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|arabic|مترجم|مدبلج)\\b"), " ")
        .replace(Regex("[._|]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun localizeJob(job: String): String = when (job.lowercase()) {
        "director" -> "المخرج"
        "writer", "screenplay" -> "الكاتب"
        "creator" -> "المنشئ"
        else -> job
    }

    private data class SearchResponse(val results: List<SearchItem> = emptyList())
    private data class SearchItem(val id: Int)
    private data class NamedValue(val id: Int = 0, val name: String? = null)
    private data class CreditResponse(val cast: List<CastItem> = emptyList(), val crew: List<CrewItem> = emptyList())
    private data class CastItem(val id: Int, val name: String, val character: String? = null, @SerializedName("profile_path") val profilePath: String? = null)
    private data class CrewItem(val name: String, val job: String)
    private data class ImageItem(@SerializedName("file_path") val filePath: String? = null)
    private data class ImagesResponse(val logos: List<ImageItem> = emptyList())
    private data class PersonSearchResponse(val results: List<PersonSearchItem> = emptyList())
    private data class PersonSearchItem(val id: Int, val name: String, @SerializedName("profile_path") val profilePath: String? = null)
    private data class CombinedCreditsResponse(val cast: List<CombinedCreditItem> = emptyList())
    private data class CombinedCreditItem(
        val title: String? = null,
        val name: String? = null,
        @SerializedName("vote_count") val voteCount: Int = 0,
        val popularity: Double = 0.0
    )
    private data class RecommendationResponse(val results: List<RecommendationItem> = emptyList())
    private data class RecommendationItem(val title: String? = null, val name: String? = null)
    private data class DetailResponse(
        val id: Int,
        val title: String? = null,
        val name: String? = null,
        val overview: String? = null,
        @SerializedName("vote_average") val voteAverage: Double = 0.0,
        @SerializedName("vote_count") val voteCount: Int = 0,
        @SerializedName("release_date") val releaseDate: String? = null,
        @SerializedName("first_air_date") val firstAirDate: String? = null,
        val runtime: Int? = null,
        @SerializedName("episode_run_time") val episodeRunTime: List<Int>? = null,
        val genres: List<NamedValue>? = null,
        @SerializedName("poster_path") val posterPath: String? = null,
        @SerializedName("backdrop_path") val backdropPath: String? = null,
        val credits: CreditResponse? = null,
        val images: ImagesResponse? = null
    )
}
