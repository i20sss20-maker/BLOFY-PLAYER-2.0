package tv.blofy.player.ui.browser

import java.util.Locale

/**
 * Display-only organization for imported Xtream categories. Keeps IDs and
 * their server ordering intact; never modifies the catalog or user filters.
 */
internal object CategoryPresentation {
    fun cleanTitle(value: String): String {
        val cleaned = value.replace(Regex("#{3,}"), " ")
            .replace(Regex("\\s{2,}"), " ").trim()
        return cleaned.ifEmpty { value.trim() }
    }

    fun <T> order(rows: List<T>, enabled: Boolean, name: (T) -> String): List<T> {
        if (!enabled) return rows
        return rows.withIndex().sortedWith(
            compareBy<IndexedValue<T>> { priority(name(it.value)) }
                .thenBy { it.index }
        ).map { it.value }
    }

    private fun priority(value: String): Int {
        val text = value.lowercase(Locale.ROOT)
        return when {
            listOf("sport", "sports", "ssc", "bein", "رياض", "كرة", "مباريات").any(text::contains) -> 0
            listOf("news", "اخبار", "أخبار", "إخبار").any(text::contains) -> 1
            listOf("kids", "cartoon", "أطفال", "اطفال", "كرتون").any(text::contains) -> 2
            listOf("movie", "cinema", "film", "أفلام", "افلام").any(text::contains) -> 3
            listOf("arab", "عرب", "saudi", "سعود").any(text::contains) -> 4
            else -> 5
        }
    }
}
