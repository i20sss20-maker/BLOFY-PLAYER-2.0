package tv.blofy.player.data.m3u

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.core.network.awaitResponse
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class M3uPlaylistLoader(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(35, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
) {
    suspend fun load(provider: ProviderEntity): ParsedM3u = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(provider.baseUrl).header("User-Agent", "BLOFY PLAYER/2.0").build()
        val coroutineContext = currentCoroutineContext()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error("M3U HTTP ${response.code}")
            parse(provider, response.body?.string().orEmpty()) { coroutineContext.ensureActive() }
        }
    }

    fun parse(provider: ProviderEntity, text: String): ParsedM3u = parse(provider, text) {}

    private fun parse(provider: ProviderEntity, text: String, cancellationCheck: () -> Unit): ParsedM3u {
        val entries = mutableListOf<Entry>()
        var pending: Metadata? = null
        var lineIndex = 0
        text.lineSequence().forEach { raw ->
            if (lineIndex++ % 256 == 0) cancellationCheck()
            val line = raw.trim()
            when {
                line.startsWith("#EXTINF", true) -> pending = parseMetadata(line)
                line.isNotBlank() && !line.startsWith("#") -> {
                    val meta = pending ?: Metadata(name = line)
                    entries += Entry(meta, line)
                    pending = null
                }
            }
        }

        val categories = linkedMapOf<String, CategoryEntity>()
        val streams = linkedMapOf<String, StreamEntity>()
        val episodes = mutableListOf<EpisodeEntity>()
        val seriesSeen = mutableSetOf<String>()

        fun addCategory(key: String, row: CategoryEntity) {
            if (!categories.containsKey(key)) categories[key] = row
        }

        entries.forEachIndexed { index, entry ->
            if (index % 256 == 0) cancellationCheck()
            val series = SERIES_PATTERN.find(entry.meta.name)
            if (series != null) {
                val seriesName = series.groupValues[1].trim(' ', '-', '.', '_')
                val season = series.groupValues[2].toIntOrNull() ?: 0
                val episodeNo = series.groupValues[3].toIntOrNull() ?: 0
                val seriesId = stableId("series|${seriesName.lowercase()}")
                val category = entry.meta.group.ifBlank { "Series" }
                val categoryId = stableId("series-category|$category")
                addCategory("series:$categoryId", CategoryEntity("${provider.id}:series:$categoryId", provider.id, categoryId, "series", category, categories.size))
                if (seriesSeen.add(seriesId)) {
                    streams[seriesId] = StreamEntity(
                        key = "${provider.id}:series:$seriesId", providerId = provider.id, remoteId = seriesId,
                        categoryId = categoryId, kind = "series", name = seriesName, icon = entry.meta.logo,
                        streamType = "m3u-series"
                    )
                }
                val episodeId = stableId(entry.url)
                episodes += EpisodeEntity(
                    key = "${provider.id}:episode:$episodeId", providerId = provider.id, seriesId = seriesId,
                    remoteId = episodeId, season = season, episode = episodeNo, title = entry.meta.name,
                    extension = extension(entry.url) ?: "mp4", directSource = entry.url
                )
                return@forEachIndexed
            }

            val kind = if (looksLikeMovie(entry)) "movie" else "live"
            val category = entry.meta.group.ifBlank { if (kind == "movie") "Movies" else "Live" }
            val categoryId = stableId("$kind-category|$category")
            addCategory("$kind:$categoryId", CategoryEntity("${provider.id}:$kind:$categoryId", provider.id, categoryId, kind, category, categories.size))
            val streamId = stableId(entry.url)
            streams["$kind:$streamId"] = StreamEntity(
                key = "${provider.id}:$kind:$streamId", providerId = provider.id, remoteId = streamId,
                categoryId = categoryId, kind = kind, name = entry.meta.name.ifBlank { "BLOFY" },
                icon = entry.meta.logo, extension = extension(entry.url), directSource = entry.url,
                epgChannelId = entry.meta.tvgId, streamType = "m3u"
            )
        }

        return ParsedM3u(categories.values.toList(), streams.values.toList(), episodes.sortedWith(compareBy<EpisodeEntity> { it.seriesId }.thenBy { it.season }.thenBy { it.episode }))
    }

    private fun parseMetadata(line: String): Metadata = Metadata(
        line.substringAfter(',', "").trim(), attribute(line, "group-title").orEmpty(), attribute(line, "tvg-logo"), attribute(line, "tvg-id")
    )

    private fun attribute(line: String, name: String): String? = Regex("(?i)${Regex.escape(name)}=\"([^\"]*)\"").find(line)?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }

    private fun looksLikeMovie(entry: Entry): Boolean {
        val group = entry.meta.group.lowercase()
        if (listOf("vod", "movie", "movies", "film", "films", "أفلام", "افلام").any { group.contains(it) }) return true
        return extension(entry.url)?.lowercase() in setOf("mp4", "mkv", "avi", "mov", "webm", "m4v")
    }

    private fun extension(url: String): String? = runCatching { URI(url).path.substringAfterLast('.', "").takeIf { it.length in 2..5 } }.getOrNull()
    private fun stableId(value: String): String = MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).take(8).joinToString("") { "%02x".format(it) }

    data class ParsedM3u(val categories: List<CategoryEntity>, val streams: List<StreamEntity>, val episodes: List<EpisodeEntity>)
    private data class Entry(val meta: Metadata, val url: String)
    private data class Metadata(val name: String, val group: String = "", val logo: String? = null, val tvgId: String? = null)

    companion object { private val SERIES_PATTERN = Regex("(?i)^(.+?)[ ._\\-]+S(\\d{1,2})E(\\d{1,3})(?:[ ._\\-]+.*)?$") }
}
