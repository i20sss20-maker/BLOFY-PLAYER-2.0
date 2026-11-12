package tv.blofy.player.ui.search

import java.text.Normalizer
import java.util.Locale
import tv.blofy.player.data.metadata.ProviderMetadata

/**
 * Local actor/director searches. No queries are sent to an AI vendor.
 * Source credit data must exist before we can claim a match.
 */
internal object CastSearchPolicy {
    private val arabicDiacritics = Regex("[\\u064B-\\u065F\\u0670]")
    private val whitespace = Regex("\\s+")
    private val prefixes = listOf(
        Regex("^(?:افلام|الافلام|مسلسلات|المسلسلات|اعمال|اعمال|ابطال|افلامه|مسلسلاته)\\s+(?:ل|من|فيها|بطوله|بطولة|مع|للممثل|للممثله|للممثلة)?\\s*"),
        Regex("^(?:الممثل|الممثله|الممثلة|ممثل|ممثله|ممثلة|بطوله|بطولة|المخرج|مخرج)\\s+"),
        Regex("^(?:movies|films|series|shows)\\s+(?:with|starring|by|of)\\s+"),
        Regex("^(?:actor|actress|starring|director)\\s*:?\\s+")
    )

    fun normalize(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .lowercase(Locale.ROOT)
        .replace(arabicDiacritics, "")
        .replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
        .replace('ى', 'ي').replace('ة', 'ه')
        .replace(whitespace, " ").trim()

    fun actorTerm(input: String): String {
        var value = normalize(input.take(100))
        for (pattern in prefixes) value = value.replace(pattern, "").trim()
        // Preserve original names such as "ليوناردو" and "Liam".
        return value
    }

    fun matches(metadata: ProviderMetadata.Metadata, input: String): Boolean {
        val term = actorTerm(input)
        if (term.length < 2) return false
        return metadata.cast.orEmpty().any { it.name.isNotBlank() && normalize(it.name).contains(term) }
            || metadata.crew.orEmpty().any { it.name.isNotBlank() && normalize(it.name).contains(term) }
    }

    fun candidateToken(input: String): String = actorTerm(input)
        .split(" ").firstOrNull().orEmpty().take(40)

    fun searchable(input: String): Boolean = actorTerm(input).length in 2..80
}
