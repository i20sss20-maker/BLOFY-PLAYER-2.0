package tv.blofy.player.data.metadata

import okhttp3.HttpUrl.Companion.toHttpUrl
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
        if (root.isEmpty()) return null
        check(root.keys.any { it.equals("info", true) || it.equals("movie_data", true) ||
            it.equals("data", true) || it.equals("plot", true) || it.equals("description", true) ||
            it.equals("overview", true) || it.equals("actors", true) || it.equals("cast", true) }) { "Provider returned no details" }
        return parseResponse(provider, stream, root, kind)
    }

    internal fun parseResponse(provider: ProviderEntity, stream: StreamEntity, root: Map<String, Any?>, kind: String): ProviderMetadata.Metadata? {
        val payload = map(root["data"]).ifEmpty { root }
        val source = linkedMapOf<String, Any?>()
        // Some panels put fields on the root, others use info/movie_data. Blank fields
        // in info must not erase useful values supplied elsewhere in the same response.
        listOf(payload, map(payload["movie_data"]), map(payload["info"])).forEach { fields ->
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
        val cast = castValues(source).take(14)
        val crew = buildList {
            splitValues(text(source, "director")).take(3).forEach { add(ProviderMetadata.Credit(it, "المخرج")) }
            splitValues(text(source, "writer", "writers")).take(3).forEach { add(ProviderMetadata.Credit(it, "الكاتب")) }
        }.distinctBy { it.name to it.job }

        val rating = number(source["rating"] ?: source["rating_5based"] ?: stream.rating)
        val releaseDate = text(source, "releasedate", "release_date", "releaseDate", "first_air_date")
            .ifBlank { stream.releaseDate.orEmpty() }.ifBlank { null }
        val durationMinutes = durationMinutes(source, stream)
        val poster = text(source, "movie_image", "cover", "cover_big", "stream_icon")
            .ifBlank { stream.icon.orEmpty() }.ifBlank { null }
        val backdrop = firstBackdrop(source["backdrop_path"] ?: source["backdrop"])
            ?: stream.backdrop?.takeIf(String::isNotBlank)
        val country = splitValues(text(source, "country", "production_countries"))
        val language = text(source, "language", "original_language").ifBlank { null }
        val status = text(source, "status").ifBlank { null }

        val hasUsefulData = cast.isNotEmpty() || crew.isNotEmpty() || !plot.isNullOrBlank() ||
            genres.isNotEmpty() || !poster.isNullOrBlank() || !backdrop.isNullOrBlank()
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
            logoUrl = null,
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
        return listOf("cast", "actors", "actor").flatMap { key ->
            people(source[key])
        }.distinctBy { it.name.lowercase(java.util.Locale.ROOT) }.take(14)
    }

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
                    .takeIf { it.startsWith("http://") || it.startsWith("https://") }
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

    private fun firstBackdrop(value: Any?): String? = when (value) {
        is String -> value.trim().takeIf(String::isNotBlank)
        is List<*> -> value.asSequence().mapNotNull { it?.toString()?.trim() }.firstOrNull(String::isNotBlank)
        else -> null
    }
}
