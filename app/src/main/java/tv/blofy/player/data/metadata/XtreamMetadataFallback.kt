package tv.blofy.player.data.metadata

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import androidx.core.text.HtmlCompat
import com.google.gson.Gson
import kotlinx.coroutines.withTimeout
import tv.blofy.player.BlofyApp
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient

/**
 * Provider-only metadata. Cached data renders first; a bounded detail request enriches
 * the open title without scanning the catalog or delaying playback controls.
 */
object XtreamMetadataFallback {
    suspend fun movie(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        BlofyApp.contextOrNull()?.let { ProviderMetadataCache.read(it, stream.key) }

    suspend fun series(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        BlofyApp.contextOrNull()?.let { ProviderMetadataCache.read(it, stream.key) }

    internal suspend fun fetchMovie(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        load(provider, stream, "get_vod_info", "vod_id", "movie")

    internal suspend fun fetchSeries(provider: ProviderEntity, stream: StreamEntity): ProviderMetadata.Metadata? =
        load(provider, stream, "get_series_info", "series_id", "tv")

    private suspend fun load(
        provider: ProviderEntity,
        stream: StreamEntity,
        action: String,
        idKey: String,
        kind: String
    ): ProviderMetadata.Metadata? {
        if (!provider.providerType.equals("xtream", true) || stream.remoteId.isBlank()) return null
        val url = runCatching {
            (provider.baseUrl.trim().trimEnd('/') + "/player_api.php").toHttpUrl().newBuilder()
                .addQueryParameter("username", provider.username)
                .addQueryParameter("password", provider.password)
                .addQueryParameter("action", action)
                .addQueryParameter(idKey, stream.remoteId)
                .build().toString()
        }.getOrNull() ?: return null

        val root = withTimeout(8_000L) { XtreamClient.api.objectResponse(url) }
        check(root.isNotEmpty()) { "Provider returned no details" }
        return parseResponse(provider, stream, root, kind)
    }

    internal fun parseResponse(provider: ProviderEntity, stream: StreamEntity, root: Map<String, Any?>, kind: String): ProviderMetadata.Metadata? {
        val payload = map(root["data"]).ifEmpty { root }
        val source = linkedMapOf<String, Any?>()
        // Some panels put fields on the root, others use info/movie_data. Blank fields
        // in info must not erase useful values supplied elsewhere in the same response.
        listOf(root, map(root["movie_data"]), map(root["info"]), payload, map(payload["movie_data"]), map(payload["info"])).forEach { fields ->
            fields.forEach { (key, value) ->
                if (value != null && (value !is String || (value.isNotBlank() && !value.equals("null", true))) && value != emptyList<Any>())
                    source[key.lowercase(java.util.Locale.ROOT)] = value
            }
        }
        if (source.isEmpty()) return null

        val title = text(source, "name", "title", "o_name").ifBlank { stream.name }
        val plot = cleanText(text(source, "plot", "description", "overview", "synopsis")).ifBlank { stream.plot.orEmpty() }.ifBlank { null }
        val genreText = text(source, "genre", "genres").ifBlank { stream.genre.orEmpty() }
        val genres = splitValues(genreText)
        val cast = castValues(source).map { it.copy(profileUrl = imageUrl(it.profileUrl, provider)) }
        val crew = buildList {
            val credits = map(source["credits"])
            listOf(source["crew"], credits["crew"]).forEach { raw ->
                (raw as? List<*>)?.forEach { item ->
                    val row = map(item)
                    val name = cleanText(text(row, "name"))
                    if (name.isNotBlank()) add(ProviderMetadata.Credit(name,
                        cleanText(text(row, "job", "department")),
                        imageUrl(text(row, "profile_url", "profile_path", "image", "photo"), provider)))
                }
            }
            splitValues(text(source, "director")).take(3).forEach { add(ProviderMetadata.Credit(it, "المخرج")) }
            splitValues(text(source, "writer", "writers")).take(3).forEach { add(ProviderMetadata.Credit(it, "الكاتب")) }
        }.distinctBy { it.name to it.job }

        val rating = number(source["rating"])?.takeIf { it <= 10 }
            ?: number(source["rating_5based"])?.takeIf { it <= 5 }?.times(2)
            ?: number(source["vote_average"])?.takeIf { it <= 10 }
            ?: number(stream.rating)?.takeIf { it <= 10 }
        val releaseDate = text(source, "releasedate", "release_date", "releaseDate", "first_air_date")
            .ifBlank { stream.releaseDate.orEmpty() }.ifBlank { null }
        val durationMinutes = durationMinutes(source, stream)
        val images = map(source["images"])
        val poster = imageUrl(text(source, "movie_image", "cover", "cover_big", "stream_icon", "poster_path"), provider)
            ?: imageUrl(firstBackdrop(images["posters"]), provider) ?: stream.icon?.takeIf(String::isNotBlank)
        val backdrop = imageUrl(firstBackdrop(source["backdrop_path"] ?: source["backdrop"] ?: images["backdrops"]), provider)
            ?: stream.backdrop?.takeIf(String::isNotBlank)
        val logo = imageUrl(text(source, "logo", "logo_url", "logo_path"), provider)
            ?: imageUrl(firstBackdrop(images["logos"]), provider)
        val country = countryValues(source)
        val language = text(source, "language", "original_language").ifBlank { null }
        val status = text(source, "status").ifBlank { null }

        val hasUsefulData = cast.isNotEmpty() || crew.isNotEmpty() || !plot.isNullOrBlank() ||
            genres.isNotEmpty() || rating != null || !poster.isNullOrBlank() || !backdrop.isNullOrBlank() || logo != null ||
            country.isNotEmpty()
        if (!hasUsefulData) return null

        return ProviderMetadata.Metadata(
            kind = kind,
            title = title,
            overview = plot,
            rating = rating,
            releaseDate = releaseDate,
            runtimeMinutes = durationMinutes,
            genres = genres,
            posterUrl = poster,
            backdropUrl = backdrop,
            logoUrl = logo,
            trailerUrl = text(source, "youtube_trailer", "trailer").ifBlank { null },
            cast = cast,
            crew = crew,
            countries = country,
            originalLanguage = language,
            status = status,
            networks = splitValues(text(source, "network", "networks")),
        )
    }

    internal fun castValues(source: Map<String, Any?>): List<ProviderMetadata.Person> {
        return mergePeople(listOf("cast", "actors", "actor").flatMap { people(source[it]) } +
            people(map(source["credits"])["cast"]))
    }

    internal fun mergePeople(people: List<ProviderMetadata.Person>): List<ProviderMetadata.Person> =
        people.groupBy { it.name.trim().lowercase(java.util.Locale.ROOT) }.values.map { entries ->
            entries.first().copy(
                character = entries.firstNotNullOfOrNull { it.character?.takeIf(String::isNotBlank) },
                profileUrl = entries.firstNotNullOfOrNull { it.profileUrl?.takeIf(String::isNotBlank) })
        }.take(14)

    private fun people(raw: Any?): List<ProviderMetadata.Person> = when (raw) {
        is List<*> -> raw.flatMap(::people)
        is Map<*, *> -> {
            val row = map(raw)
            val name = cleanText(text(row, "name", "actor", "actor_name"))
            if (name.isBlank()) emptyList() else listOf(ProviderMetadata.Person(
                id = -(name.hashCode().toLong().let { kotlin.math.abs(it) } % Int.MAX_VALUE).toInt().coerceAtLeast(1),
                name = name,
                character = cleanText(text(row, "character", "role")).takeIf(String::isNotBlank),
                profileUrl = text(row, "profile_url", "profile", "profile_path", "image", "photo")
                    .takeIf(String::isNotBlank)
            ))
        }
        is String -> {
            val value = raw.trim()
            if (value.startsWith("[") || value.startsWith("{")) {
                val decoded = runCatching { Gson().fromJson(value, Any::class.java) }.getOrNull()
                if (decoded is List<*> || decoded is Map<*, *>) people(decoded) else emptyList()
            } else splitValues(value).map { name ->
                ProviderMetadata.Person(-(kotlin.math.abs(name.hashCode().toLong()) % Int.MAX_VALUE)
                    .toInt().coerceAtLeast(1), name, null, null)
            }
        }
        else -> emptyList()
    }

    @Suppress("UNCHECKED_CAST")
    private fun map(value: Any?): Map<String, Any?> = when (value) {
        is Map<*, *> -> value.entries.associate { it.key.toString() to it.value }
        else -> emptyMap()
    }

    private fun text(source: Map<String, Any?>, vararg keys: String): String {
        for (key in keys) {
            val value = source.entries.firstOrNull { it.key.equals(key, true) }?.value ?: continue
            val result = when (value) {
                is String -> value
                is Number, is Boolean -> value.toString()
                is List<*> -> value.filterNotNull().joinToString(", ") { item ->
                    if (item is Map<*, *>) {
                        item.entries.firstOrNull { it.key?.toString()?.equals("name", true) == true }?.value?.toString().orEmpty()
                    } else item.toString()
                }
                else -> ""
            }.trim()
            if (result.isNotBlank() && result != "null") return result
        }
        return ""
    }

    private fun cleanText(value: String): String = HtmlCompat.fromHtml(value, HtmlCompat.FROM_HTML_MODE_LEGACY)
        .toString().replace('\u00a0', ' ').trim()

    private fun splitValues(value: String): List<String> = value
        .replace(" • ", ",").replace(" / ", ",")
        .split(Regex("[,،;|\\r\\n]+"))
        .map { cleanText(it).trim().trim('"') }
        .filter { it.isNotBlank() && !it.equals("null", true) }
        .distinctBy { it.lowercase(java.util.Locale.ROOT) }

    private fun countryValues(source: Map<String, Any?>): List<String> =
        splitValues(
            text(
                source,
                "country",
                "countries",
                "country_name",
                "production_country",
                "production_countries",
                "origin_country"
            )
        ).map { value ->
            val code = value.trim()
            if (code.length == 2 && code.all(Char::isLetter)) {
                java.util.Locale("", code.uppercase(java.util.Locale.ROOT))
                    .getDisplayCountry(java.util.Locale.getDefault())
                    .takeIf(String::isNotBlank)
                    ?: code.uppercase(java.util.Locale.ROOT)
            } else value
        }.distinctBy { it.lowercase(java.util.Locale.ROOT) }


    private fun number(value: Any?): Double? = when (value) {
        is Number -> value.toDouble().takeIf { it > 0.0 }
        is String -> value.trim().toDoubleOrNull()?.takeIf { it > 0.0 }
        else -> null
    }

    private fun durationMinutes(source: Map<String, Any?>, stream: StreamEntity): Int? {
        val seconds = number(source["duration_secs"] ?: source["duration_seconds"])?.toLong()
        if (seconds != null && seconds > 0) return ((seconds + 59) / 60).toInt()
        val value = text(source, "duration").ifBlank { stream.duration.orEmpty() }
        value.toIntOrNull()?.takeIf { it in 1..1000 }?.let { return it }
        val parts = value.split(':').mapNotNull { it.toIntOrNull() }
        return when (parts.size) {
            3 -> parts[0] * 60 + parts[1] + if (parts[2] >= 30) 1 else 0
            2 -> parts[0] + if (parts[1] >= 30) 1 else 0
            else -> null
        }
    }

    private fun imageUrl(raw: String?, provider: ProviderEntity): String? {
        val value = raw?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", true) } ?: return null
        val parsed = value.toHttpUrlOrNull() ?: provider.baseUrl.toHttpUrlOrNull()?.resolve(value)
        return parsed?.takeIf { it.username.isEmpty() && it.password.isEmpty() }?.toString()
    }

    private fun firstBackdrop(value: Any?): String? = when (value) {
        is String -> {
            val trimmed = value.trim()
            if (trimmed.startsWith("[")) firstBackdrop(runCatching { Gson().fromJson(trimmed, List::class.java) }.getOrNull())
            else trimmed.takeIf(String::isNotBlank)
        }
        is List<*> -> value.firstNotNullOfOrNull(::firstBackdrop)
        is Map<*, *> -> text(map(value), "url", "file_path", "path").takeIf(String::isNotBlank)
        else -> null
    }
}
