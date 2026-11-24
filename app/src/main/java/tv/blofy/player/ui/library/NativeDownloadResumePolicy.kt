package tv.blofy.player.ui.library

/** Resume only a byte-identical representation identified by a strong ETag.
 * No validator means a fresh download; a changed validator never appends. */
internal object NativeDownloadResumePolicy {
    private val range = Regex("bytes ([0-9]+)-([0-9]+)/([0-9]+)")
    fun strongTag(raw: String?): String? =
        raw?.takeIf { it.length in 3..256 && it.first() == '"' && it.last() == '"' &&
            it.substring(1,it.length-1).all { c -> c.code in 33..126 && c != '"' } }

    data class Plan(val offset: Long, val total: Long, val tag: String?)

    fun plan(status: Int, requestedOffset: Long, previousTag: String?, responseTag: String?,
             contentRange: String?, length: Long): Plan? {
        if (length <= 0L) return null
        val tag = strongTag(responseTag)
        if (status == 200) return Plan(0,length,tag)
        if (status != 206 || requestedOffset <= 0 || tag == null ||
            tag != strongTag(previousTag)) return null
        val match = range.matchEntire(contentRange.orEmpty()) ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val end = match.groupValues[2].toLongOrNull() ?: return null
        val total = match.groupValues[3].toLongOrNull() ?: return null
        if (start != requestedOffset || total <= start || end != total-1 ||
            length != total-start) return null
        return Plan(start,total,tag)
    }
}
