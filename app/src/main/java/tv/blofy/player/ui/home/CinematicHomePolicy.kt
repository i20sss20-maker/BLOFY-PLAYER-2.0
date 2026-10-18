package tv.blofy.player.ui.home

import tv.blofy.player.data.local.StreamEntity

/**
 * Curated, honest home rails: only actual titles from the selected user's provider.
 * No invented posters, popularity numbers, streams, IMDb ratings or external media.
 */
internal object CinematicHomePolicy {
    internal data class Collection(val title: String, val items: List<StreamEntity>)

    private val universeRules: List<Pair<String, Regex>> = listOf(
        "عالم Spider-Man" to Regex("""spider[\s\-]?man|سبايدر[\s\-]?مان""", RegexOption.IGNORE_CASE),
        "عالم Batman" to Regex("""batman|باتمان|الرجل الخفاش""", RegexOption.IGNORE_CASE),
        "سلسلة Avengers" to Regex("""avengers|افنجرز|المنتقمون""", RegexOption.IGNORE_CASE),
        "عالم Harry Potter" to Regex("""harry[\s\-]?potter|هاري[\s\-]?بوتر""", RegexOption.IGNORE_CASE),
        "عالم Star Wars" to Regex("""star[\s\-]?wars|حرب[\s\-]?النجوم""", RegexOption.IGNORE_CASE),
        "سلسلة John Wick" to Regex("""john[\s\-]?wick|جون[\s\-]?ويك""", RegexOption.IGNORE_CASE),
        "سلسلة Fast & Furious" to Regex("""fast(?:\s+and|\s*&)?\s+furious|فاست[\s\-]?اند[\s\-]?فيريوس""", RegexOption.IGNORE_CASE),
        "عالم Toy Story" to Regex("""toy[\s\-]?story|حكاية[\s\-]?لعبة""", RegexOption.IGNORE_CASE)
    )

    fun heroCandidates(items: List<StreamEntity>, max: Int = 5): List<StreamEntity> {
        if (max <= 0) return emptyList()
        val unique = items.filter { (it.kind == "movie" || it.kind == "series") &&
            !it.locked && it.name.isNotBlank() }.distinctBy { it.key }
        val images = unique.filter { !it.backdrop.isNullOrBlank() || !it.icon.isNullOrBlank() }
        // Real wide backdrops make the hero cinematic; if absent we show available posters.
        return (images.filter { !it.backdrop.isNullOrBlank() } +
            images.filter { it.backdrop.isNullOrBlank() } + unique)
            .distinctBy { it.key }
            .take(max)
    }

    fun universeRails(items: List<StreamEntity>): List<Collection> {
        val safeItems = items.filter { !it.locked && (it.kind == "movie" || it.kind == "series") }
            .distinctBy { it.key }
        return universeRules.mapNotNull { (title, pattern) ->
            val matches = safeItems.filter { pattern.containsMatchIn(it.name) }
            if (matches.size >= 2) Collection(title, matches.take(15)) else null
        }
    }

    fun ratingBadge(rating: String?): String? {
        val raw = rating?.trim().orEmpty()
        // A single rating from the IPTV provider is not an IMDb/TMDB verified score.
        val value = raw.toDoubleOrNull() ?: return null
        return raw.takeIf { value in 0.1..10.0 && raw.length <= 4 }?.let { "★ $it" }
    }
}
