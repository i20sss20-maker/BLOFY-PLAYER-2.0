package tv.blofy.player.ui.player

import android.net.Uri
import android.util.Xml
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

/**
 * Read-only, offline parser for a file selected INSIDE BLOFY STREAM.
 * Importing never adds an Xtream host, changes code activation, calls a URL,
 * or uploads a file. The resulting candidates are session-local until the
 * operator explicitly bundles a catalog with an APK update.
 */
internal object StreamInAppAudioImport {
    private const val MAX_CHARS = 262_144
    private const val MAX_ITEMS = 40
    private val formats = setOf("m3u", "m3u8", "txt", "cfg", "xml", "json")
    private val mediaVideo = Regex("(?i)\\.(mp4|ts|mkv|avi|webm|mov|m2ts)(?:[?#].*)?$")
    private val urlKeys = setOf("url", "src", "href", "stream", "stream_url",
        "streamurl", "audio", "audio_url", "audiourl", "link", "playbackurl", "source")
    private val nameKeys = listOf("label", "name", "title", "description")
    data class Preview(val tracks: List<StreamArabicAudioCatalog.Track>, val note: String? = null)

    fun parse(fileName: String, contents: String): Preview {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        if (ext !in formats) return Preview(emptyList(), "unsupported")
        if (contents.length > MAX_CHARS) return Preview(emptyList(), "too_large")
        if (contents.isBlank()) return Preview(emptyList(), "empty")
        val tracks = linkedMapOf<String, StreamArabicAudioCatalog.Track>()
        fun add(url: String?, label: String?, delay: Int = 0) {
            val candidate = url?.trim()?.trim('"', '\'') ?: return
            if (tracks.size >= MAX_ITEMS ||
                !StreamArabicAudioCatalog.playableUrl(candidate) ||
                mediaVideo.containsMatchIn(Uri.parse(candidate).path.orEmpty())) return
            if (candidate in tracks) return
            val path = Uri.parse(candidate).path.orEmpty()
            val format = if (path.endsWith(".m3u8", ignoreCase = true)) "hls" else "progressive"
            val cleanLabel = label?.trim()?.take(80).orEmpty().ifBlank { "Arabic audio ${tracks.size + 1}" }
            tracks[candidate] = StreamArabicAudioCatalog.Track(
                id = "import_${tracks.size + 1}",
                label = cleanLabel,
                playbackUrl = candidate,
                initialDelaySeconds = ArabicSidecarTimingPolicy.clamp(delay),
                format = format
            )
        }

        when (ext) {
            "m3u", "m3u8", "txt", "cfg" -> parseLines(ext, contents, ::add)
            "json" -> parseJson(contents, ::add)
            "xml" -> parseXml(contents, ::add)
        }
        val note = if (tracks.isEmpty() && ext == "m3u8" &&
            contents.contains("#EXT-X-", ignoreCase = true)) "manifest_not_a_source_url"
            else if (tracks.isEmpty()) "no_audio_links" else null
        return Preview(tracks.values.toList(), note)
    }

    private fun parseLines(
        extension: String, contents: String, add: (String?, String?, Int) -> Unit
    ) {
        val lines = contents.lineSequence()
        // An HLS manifest contains fragments, not an actual selectable
        // upstream playlist URL; never misinterpret its segments as live feeds.
        val isManifest = extension == "m3u8" ||
            contents.lineSequence().take(40).any { it.trim().startsWith("#EXT-X-") }
        if (isManifest) return
        var label = ""
        for (line in lines.take(10_000)) {
            val trimmed = line.trim()
            if (trimmed.startsWith("#EXTINF", ignoreCase = true)) {
                label = Regex("""(?i)(?:tvg-name|title)\s*=\s*"([^"]{1,80})" """.trim())
                    .find(trimmed)?.groupValues?.get(1)
                    ?: trimmed.substringAfterLast(',').trim().take(80)
                continue
            }
            if (trimmed.startsWith("#") || trimmed.isEmpty()) continue
            val keyValue = Regex("""(?i)^\s*(url|src|href|stream|audio_url|audio|link|source)\s*[:=]\s*(.*)$""")
                .find(trimmed)
            val url = (keyValue?.groupValues?.get(2) ?: trimmed).trim()
            if (url.startsWith("https://", ignoreCase = true)) add(url, label, 0)
            label = ""
        }
    }

    private fun parseJson(contents: String, add: (String?, String?, Int) -> Unit) {
        var nodesLeft = 1000
        lateinit var walk: (Any?, String, Int) -> Unit
        walk = { node, label, depth ->
            if (--nodesLeft >= 0 && depth <= 12) {
                when (node) {
                    is JSONArray -> for (i in 0 until minOf(node.length(), 200))
                        walk(node.opt(i), label, depth + 1)
                    is JSONObject -> {
                        val name = nameKeys.firstNotNullOfOrNull { key ->
                            node.optString(key).takeIf { it.isNotBlank() }
                        } ?: label
                        val delay = node.optInt("delaySeconds", 0)
                        val keys = node.keys()
                        while (keys.hasNext()) {
                            val key = keys.next()
                            val value = node.opt(key)
                            if (key.lowercase() in urlKeys && value is String) add(value, name, delay)
                            if (value is JSONObject || value is JSONArray) walk(value, name, depth + 1)
                        }
                    }
                }
            }
        }
        val root = runCatching {
            val trimmed = contents.trimStart()
            if (trimmed.startsWith("[")) JSONArray(contents) else JSONObject(contents)
        }.getOrNull() ?: return
        walk(root, "", 0)
    }

    private fun parseXml(contents: String, add: (String?, String?, Int) -> Unit) {
        if (Regex("(?i)<!DOCTYPE|<!ENTITY").containsMatchIn(contents)) return
        runCatching {
            val parser = Xml.newPullParser()
            parser.setInput(StringReader(contents))
            var event = parser.eventType
            var inspected = 0
            var currentLabel = ""
            var currentTag = ""
            while (event != XmlPullParser.END_DOCUMENT && inspected++ < 8_000) {
                when (event) {
                    XmlPullParser.START_TAG -> {
                        currentTag = parser.name?.lowercase().orEmpty()
                        currentLabel = parser.getAttributeValue(null, "label")
                            ?: parser.getAttributeValue(null, "title")
                            ?: parser.getAttributeValue(null, "name")
                            ?: currentLabel
                        for (i in 0 until parser.attributeCount) {
                            val key = parser.getAttributeName(i).lowercase()
                            if (key in urlKeys) add(parser.getAttributeValue(i), currentLabel, 0)
                        }
                    }
                    XmlPullParser.TEXT -> {
                        if (currentTag in urlKeys) add(parser.text, currentLabel, 0)
                    }
                }
                event = parser.next()
            }
        }
    }
}
