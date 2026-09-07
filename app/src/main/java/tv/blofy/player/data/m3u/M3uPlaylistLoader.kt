package tv.blofy.player.data.m3u

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class M3uPlaylistLoader(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(60, TimeUnit.SECONDS)
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()
) {
    suspend fun load(provider: ProviderEntity): ParsedM3u = withContext(Dispatchers.IO) {
        val coroutineContext = currentCoroutineContext()
        val profiles = requestProfiles(provider.baseUrl)
        var lastStatus: Int? = null
        var lastBody = ""
        var lastFailure: Throwable? = null

        profiles.forEachIndexed { index, request ->
            coroutineContext.ensureActive()
            try {
                client.newCall(request).awaitResponse().use { response ->
                    lastStatus = response.code
                    val body = response.body?.string().orEmpty().removePrefix("\uFEFF")
                    lastBody = body

                    // IPTV gateways can answer with non-standard statuses such as 884 while the
                    // payload itself is a valid playlist. Content is authoritative, never the code.
                    if (looksLikeM3u(body)) {
                        return@withContext parse(provider, body) { coroutineContext.ensureActive() }
                    }

                    // 884 is also commonly a compatibility/profile rejection. Try VLC and Android
                    // TV profiles before giving up; malformed 884 bodies are never accepted.
                    if (!shouldRetry(response.code) && index == profiles.lastIndex && response.isSuccessful) {
                        error("M3U response is not a playlist")
                    }
                }
            } catch (failure: Throwable) {
                coroutineContext.ensureActive()
                lastFailure = failure
                if (index == profiles.lastIndex) throw failure
            }
        }

        if (looksLikeM3u(lastBody)) return@withContext parse(provider, lastBody) { coroutineContext.ensureActive() }
        val status = lastStatus?.let { " HTTP $it" }.orEmpty()
        val detail = lastFailure?.message?.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()
        error("M3U$status failed$detail")
    }

    private fun requestProfiles(url: String): List<Request> = listOf(
        Request.Builder().url(url)
            .header("User-Agent", "BLOFY PLAYER/2.0")
            .header("Accept", "application/x-mpegURL,application/vnd.apple.mpegurl,audio/mpegurl,text/plain,*/*")
            .header("Accept-Encoding", "identity")
            .build(),
        Request.Builder().url(url)
            .header("User-Agent", "VLC/3.0.21 LibVLC/3.0.21")
            .header("Accept", "*/*")
            .header("Accept-Encoding", "identity")
            .header("Connection", "close")
            .build(),
        Request.Builder().url(url)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 Chrome/120 Safari/537.36")
            .header("Accept", "*/*")
            .header("Accept-Encoding", "identity")
            .build()
    )

    private fun shouldRetry(code: Int): Boolean = code == 884 || code in setOf(403, 406, 408, 425, 429) || code >= 500

    internal fun looksLikeM3u(text: String): Boolean {
        val sample = text.trimStart().take(64 * 1024)
        if (sample.startsWith("#EXTM3U", ignoreCase = true)) return true
        return sample.contains("#EXTINF", ignoreCase = true) &&
            sample.lineSequence().any { line ->
                val value = line.trim()
                value.startsWith("http://", true) || value.startsWith("https://", true) || value.startsWith("rtsp://", true)
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
