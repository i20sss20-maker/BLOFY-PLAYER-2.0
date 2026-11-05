package tv.blofy.player.data

import java.util.Locale

/**
 * Reads a *real* get.php M3U playlist, without sorting by channel numbers, names or dates.
 * This is a separate source from the Xtream player_api.php catalogue.
 *
 * The order here is authoritative ONLY when the user explicitly chooses M3U matching
 * and sufficient IDs also exist in the already saved Xtream catalogue.
 */
internal class M3uOriginalOrder {
    val live = LinkedHashMap<String, Long>()
    val movie = LinkedHashMap<String, Long>()
    val liveGroups = LinkedHashMap<String, Int>()
    val movieGroups = LinkedHashMap<String, Int>()
    val seriesGroups = LinkedHashMap<String, Int>()
    var validHeader: Boolean = false
        private set
    var lineCount: Int = 0
        private set

    private var pendingGroup: String? = null

    fun accept(sourceLine: String) {
        lineCount++
        require(lineCount <= 2_000_000) { "M3U is unexpectedly large" }
        val line = sourceLine.trim().trimStart('\uFEFF')
        if (lineCount == 1) {
            validHeader = line.startsWith("#EXTM3U", ignoreCase = true)
            require(validHeader) { "M3U endpoint did not return an M3U playlist" }
        }
        if (line.startsWith("#EXTINF:", ignoreCase = true)) {
            pendingGroup = GROUP_TITLE.find(line)?.groupValues?.getOrNull(1)
                ?.takeIf(String::isNotBlank)?.let(::normalizeGroup)
            return
        }
        if (line.isBlank() || line.startsWith("#")) return

        // Match an Xtream media URL without ever exposing the embedded credentials.
        val match = MEDIA_PATH.find(line)
        val compactLive = if (match == null) COMPACT_LIVE_PATH.find(line) else null
        if (match != null || compactLive != null) {
            val kind = match?.groupValues?.get(1)?.lowercase(Locale.ROOT) ?: "live"
            val rawId = match?.groupValues?.get(2) ?: compactLive!!.groupValues[1]
            val id = rawId.trimStart('0').ifEmpty { "0" }
            val rows = when (kind) {
                "live" -> live
                "movie" -> movie
                else -> null // /series/ links refer to EPISODES, not Xtream series IDs.
            }
            if (rows != null) {
                if (id !in rows) rows[id] = rows.size.toLong() + 1L
            }
            pendingGroup?.let { group ->
                val groups = when (kind) {
                    "live" -> liveGroups
                    "movie" -> movieGroups
                    else -> seriesGroups
                }
                if (group !in groups) groups[group] = groups.size
            }
        }
        pendingGroup = null
    }

    companion object {
        private val GROUP_TITLE = Regex("""(?:^|\s)group-title\s*=\s*"([^"]+)"""", RegexOption.IGNORE_CASE)
        private val MEDIA_PATH = Regex("""(?i)/(live|movie|series)/[^/?#]+/[^/?#]+/([0-9]+)(?:\.[a-z0-9]+)?(?:[?#]|$)""")
        // Legacy Xtream get.php M3U may use /username/password/id.ts for Live.
        private val COMPACT_LIVE_PATH = Regex(
            """(?i)^https?://[^/?#]+/[^/?#]+/[^/?#]+/([0-9]+)(?:\.(?:ts|m3u8))?(?:[?#]|$)"""
        )

        fun normalizeGroup(value: String): String =
            value.trim().replace(Regex("\\s+"), " ").lowercase(Locale.ROOT)
    }
}
