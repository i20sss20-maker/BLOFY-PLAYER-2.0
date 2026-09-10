package tv.blofy.player.ui.common

import tv.blofy.player.data.local.StreamEntity

/** Display-only provider tags. Never changes catalog names, keys, search or playback data. */
object ContentPresentation {
    data class Label(val title: String, val badges: List<String>)

    private val languages = setOf("AR", "EN", "DE", "FR", "ES", "IT", "PT", "RU", "TR", "HI", "JP", "JA", "KO", "KR", "CN", "ZH", "NL", "PL", "SE", "NO", "DK", "FI", "US", "UK")
    private val quality = mapOf("4K" to "4K", "UHD" to "4K", "2160P" to "4K", "FHD" to "FHD", "1080P" to "FHD", "HD" to "HD", "720P" to "HD", "SD" to "SD", "HDR" to "HDR", "HDR10" to "HDR10", "DV" to "DV")
    private val categoryTags = setOf("TOP", "ANM", "ANIME", "VOD", "MOV", "SERIES")
    private val split = Regex("[-_ ]+")
    // Require an explicit delimiter. Words inside a title, e.g. Top Gun, are not tags.
    private val prefix = Regex("^(?:\\[([^\\[\\]]{1,32})\\]\\s*|([^\\[\\]]{1,32}?)(?:\\s+[-–—]\\s+|\\s*[:|]\\s+))")
    private val suffix = Regex("\\s+[\\[(]([^\\[\\]()]{1,32})[\\])]$")

    fun of(stream: StreamEntity): Label = of(stream.name, stream.kind)
    fun title(name: String, kind: String = "movie"): String = of(name, kind).title

    fun of(name: String, kind: String): Label {
        if (kind !in setOf("movie", "series", "episode")) return Label(name, emptyList())
        var title = name.trim()
        val badges = linkedSetOf<String>()
        while (true) {
            val match = prefix.find(title) ?: break
            val tag = match.groupValues[1].ifEmpty { match.groupValues[2] }
            val tokens = tokens(tag) ?: break
            val rest = title.substring(match.range.last + 1).trim()
            if (rest.isBlank()) break
            tokens.mapNotNullTo(badges, ::badge)
            title = rest
        }
        while (true) {
            val match = suffix.find(title) ?: break
            val tokens = tokens(match.groupValues[1]) ?: break
            val rest = title.substring(0, match.range.first).trim()
            if (rest.isBlank()) break
            tokens.mapNotNullTo(badges, ::badge)
            title = rest
        }
        return Label(title.ifBlank { name }, badges.toList())
    }

    private fun tokens(tag: String): List<String>? {
        // Uppercase codes only; preserve ordinary words and edition descriptions.
        val tokens = split.split(tag.trim())
        if (tokens.isEmpty() || tokens.none { it in languages || it in quality || it in categoryTags }) return null
        return tokens.takeIf { parts -> parts.all { it in languages || it in quality || it in categoryTags || (it == "S" && parts.size > 1) } }
    }

    private fun badge(token: String): String? = quality[token] ?: token.takeIf { it in languages }
}
