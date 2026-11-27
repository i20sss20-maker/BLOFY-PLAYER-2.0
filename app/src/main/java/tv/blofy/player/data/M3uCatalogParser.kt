package tv.blofy.player.data

import java.io.Reader
import java.security.MessageDigest
import kotlinx.coroutines.ensureActive
import okhttp3.HttpUrl
import tv.blofy.player.core.url.PlaylistUrlPolicy

/** Extended M3U channel lists, not HLS media/variant manifests. */
internal object M3uCatalogParser {
    data class Item(val name: String, val group: String, val url: String, val icon: String?, val kind: String)
    private val attr = Regex("""([A-Za-z0-9_-]+)\s*=\s*"([^"]*)""" )
    fun identity(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).take(16).joinToString("") { "%02x".format(it.toInt() and 255) }

    suspend fun parse(reader: Reader, base: HttpUrl, emit: suspend (Item) -> Unit): Int {
        val input = reader.buffered()
        var total = 0
        var count = 0
        var header = false
        var info: String? = null
        var groupOverride: String? = null
        fun line(): String? {
            val out = StringBuilder()
            while (true) {
                val c = input.read()
                if (c == -1) return if (out.isEmpty()) null else out.toString()
                check(++total <= 40_000_000) { "Playlist exceeds size limit" }
                if (c == 10) return out.toString()
                if (c != 13) {
                    check(out.length < 65_536) { "Playlist line exceeds size limit" }
                    out.append(c.toChar())
                }
            }
        }
        while (true) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            val value = (line() ?: break).trim().trimStart('\uFEFF')
            if (value.isEmpty()) continue
            if (!header) {
                require(value.startsWith("#EXTM3U", true)) { "Invalid playlist header" }
                header = true
                continue
            }
            require(!value.startsWith("#EXT-X-", true)) { "HLS manifest is not a channel list" }
            if (value.startsWith("#EXTINF:", true)) {
                info = value.substringAfter(':')
                groupOverride = null
                continue
            }
            if (value.startsWith("#EXTGRP:", true)) {
                groupOverride = value.substringAfter(':').trim()
                continue
            }
            if (value.startsWith("#")) continue
            val details = info ?: continue
            info = null
            val target = base.resolve(value) ?: continue
            if (!PlaylistUrlPolicy.isValid(target.toString())) continue
            var quoted = false
            val comma = details.indexOfFirst { ch ->
                if (ch == '"') quoted = !quoted
                ch == ',' && !quoted
            }
            if (comma < 0) continue
            val attrs = attr.findAll(details.substring(0, comma)).associate {
                it.groupValues[1].lowercase(java.util.Locale.ROOT) to it.groupValues[2]
            }
            val name = details.substring(comma + 1).trim().ifBlank { attrs["tvg-name"].orEmpty() }.take(512)
            if (name.isBlank()) continue
            val path = target.encodedPath.lowercase(java.util.Locale.ROOT)
            val kind = if (path.contains("/movie/") || path.contains("/series/") ||
                listOf(".mp4", ".mkv", ".avi", ".mov", ".webm").any { path.endsWith(it) }) "movie" else "live"
            val group = (groupOverride ?: attrs["group-title"]).orEmpty().ifBlank {
                if (kind == "movie") "Movies" else "Live"
            }.take(256)
            val icon = attrs["tvg-logo"]?.let { base.resolve(it)?.toString() }
                ?.takeIf(PlaylistUrlPolicy::isValid)
            check(++count <= 200_000) { "Playlist exceeds item limit" }
            emit(Item(name, group, target.toString(), icon, kind))
        }
        require(header && count > 0) { "Empty or invalid channel list" }
        return count
    }
}
