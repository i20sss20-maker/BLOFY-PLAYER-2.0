package tv.blofy.player.core.text

import java.text.Normalizer

/** Normalizes Arabic and Latin catalog text into a stable local-search representation. */
object ArabicSearchNormalizer {
    private val diacritics = Regex("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]")
    private val punctuation = Regex("[^\\p{L}\\p{N}]+")
    private val whitespace = Regex("\\s+")
    private val catalogNoise = Regex(
        "(?i)\\b(4k|uhd|fhd|hd|sd|hdr|1080p|720p|2160p|arabic|english|مترجم|مدبلج|نسخة|فيلم|مسلسل)\\b"
    )

    fun normalize(value: String?): String {
        if (value.isNullOrBlank()) return ""
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
            .replace("ـ", "")
            .replace(diacritics, "")
            .replace('أ', 'ا')
            .replace('إ', 'ا')
            .replace('آ', 'ا')
            .replace('ٱ', 'ا')
            .replace('ى', 'ي')
            .replace('ؤ', 'و')
            .replace('ئ', 'ي')
            .replace('ة', 'ه')
            .lowercase()
            .replace(catalogNoise, " ")
            .replace(punctuation, " ")
            .replace(whitespace, " ")
            .trim()
    }

    fun searchable(vararg values: String?): String = values
        .asSequence()
        .map(::normalize)
        .filter(String::isNotBlank)
        .distinct()
        .joinToString(" ")

    /** Prefix matching keeps results instant from the first meaningful character. */
    fun ftsQuery(value: String): String {
        val tokens = normalize(value)
            .split(' ')
            .filter { it.length >= 1 }
            .take(8)
        return tokens.joinToString(" AND ") { token -> "\"${token.replace("\"", "\"\"")}\"*" }
    }

    fun similarity(left: String?, right: String?): Double {
        val a = normalize(left)
        val b = normalize(right)
        if (a.isBlank() || b.isBlank()) return 0.0
        if (a == b) return 1.0
        if (a.contains(b) || b.contains(a)) {
            val ratio = minOf(a.length, b.length).toDouble() / maxOf(a.length, b.length).toDouble()
            return 0.82 + ratio * 0.12
        }
        val leftTokens = a.split(' ').filter(String::isNotBlank).toSet()
        val rightTokens = b.split(' ').filter(String::isNotBlank).toSet()
        if (leftTokens.isEmpty() || rightTokens.isEmpty()) return 0.0
        val intersection = leftTokens.intersect(rightTokens).size.toDouble()
        val union = leftTokens.union(rightTokens).size.toDouble().coerceAtLeast(1.0)
        val tokenScore = intersection / union
        val editScore = 1.0 - levenshtein(a, b).toDouble() / maxOf(a.length, b.length).toDouble()
        return (tokenScore * 0.62 + editScore.coerceAtLeast(0.0) * 0.38).coerceIn(0.0, 1.0)
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var previous = IntArray(b.length + 1) { it }
        var current = IntArray(b.length + 1)
        for (i in a.indices) {
            current[0] = i + 1
            for (j in b.indices) {
                val cost = if (a[i] == b[j]) 0 else 1
                current[j + 1] = minOf(
                    current[j] + 1,
                    previous[j + 1] + 1,
                    previous[j] + cost
                )
            }
            val swap = previous
            previous = current
            current = swap
        }
        return previous[b.length]
    }
}
