package tv.blofy.player.data.m3u

data class M3uEntry(
    val name: String,
    val url: String,
    val group: String,
    val logo: String? = null,
    val tvgId: String? = null,
    val kind: String = "live"
)

object M3uParser {
    private val attr = Regex("([A-Za-z0-9_-]+)=\"([^\"]*)\"")

    fun parse(text: String): List<M3uEntry> {
        val lines = text.lineSequence().map { it.trim() }.filter { it.isNotBlank() }.toList()
        val out = mutableListOf<M3uEntry>()
        var pendingInfo: String? = null
        for (line in lines) {
            when {
                line.startsWith("#EXTINF", ignoreCase = true) -> pendingInfo = line
                line.startsWith("#") -> Unit
                line.startsWith("http://", true) || line.startsWith("https://", true) -> {
                    val info = pendingInfo
                    pendingInfo = null
                    val attrs = info?.let { attr.findAll(it).associate { m -> m.groupValues[1].lowercase() to m.groupValues[2] } }.orEmpty()
                    val name = info?.substringAfterLast(',', "")?.trim().takeUnless { it.isNullOrBlank() }
                        ?: attrs["tvg-name"]?.takeIf { it.isNotBlank() }
                        ?: "BLOFY Stream"
                    val group = attrs["group-title"]?.takeIf { it.isNotBlank() } ?: "الكل"
                    out += M3uEntry(
                        name = name,
                        url = line,
                        group = group,
                        logo = attrs["tvg-logo"]?.takeIf { it.isNotBlank() },
                        tvgId = attrs["tvg-id"]?.takeIf { it.isNotBlank() },
                        kind = inferKind(line, group)
                    )
                }
            }
        }
        return out.distinctBy { it.url }
    }

    private fun inferKind(url: String, group: String): String {
        val lowerUrl = url.lowercase()
        val lowerGroup = group.lowercase()
        return when {
            "/movie/" in lowerUrl || lowerUrl.substringBefore('?').endsWith(".mp4") || lowerUrl.substringBefore('?').endsWith(".mkv") || "movie" in lowerGroup || "film" in lowerGroup || "افلام" in lowerGroup || "أفلام" in lowerGroup -> "movie"
            else -> "live"
        }
    }
}
