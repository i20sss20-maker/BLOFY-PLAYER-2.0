package tv.blofy.player.ui.search

import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.ContentPresentation

/**
 * Cross-check LLM title suggestions against the user's ACTUAL local catalog.
 * Never show a hallucinated film that is missing from Xtream.
 * These are suggestions, not guaranteed verified actor filmographies.
 */
internal object AiCatalogMatchPolicy {
    fun isTitleMatch(title: String, item: StreamEntity): Boolean {
        if (item.kind !in setOf("movie", "series") || item.locked) return false
        val normalizedTitle = ArabicSearchNormalizer.normalize(title)
        // Provider prefixes such as EN - / [4K] and (YEAR) made correct
        // Groq suggestions disappear despite their titles being present.
        val displayed = ContentPresentation.title(item.name, item.kind)
            .replace(Regex("^(?:[A-Z]{2,3}|4K|HD|FHD)\\s*[-|:]\\s*"), "")
        val local = ArabicSearchNormalizer.normalize(displayed)
        if (normalizedTitle.length < 3 || local.isBlank()) return false
        if (normalizedTitle == local) return true
        if (local.startsWith("$normalizedTitle ") || local.endsWith(" $normalizedTitle")) return true
        return ArabicSearchNormalizer.similarity(title, item.name) >= 0.80
    }

    fun filterVerified(
        suggestions: List<String>,
        results: List<StreamEntity>,
        limit: Int = 18
    ): List<StreamEntity> = results.asSequence()
        .filter { item -> suggestions.any { text -> isTitleMatch(text, item) } }
        .distinctBy { it.key }
        .take(limit.coerceIn(1, 24)).toList()

    fun worthwhile(query: String, immediateMatches: Int, submitted: Boolean): Boolean {
        val q = query.trim()
        if (q.length !in 5..120) return false
        if (submitted) return true
        // Natural-language actor/genre requests must use AI even if an
        // unrelated show happens to match one ordinary word locally.
        if (Regex("(?i)^(?:أفلام|افلام|فيلم|مسلسلات|مسلسل|الممثل|الممثلة|بطولة|movies|films|series|shows|actor|starring)\\b").containsMatchIn(q)) {
            return q.split(Regex("\\s+")).size >= 2
        }
        // Otherwise only spend tokens on meaningful missing multiword queries.
        return immediateMatches == 0 && q.split(Regex("\\s+")).size >= 2
    }
}
