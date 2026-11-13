package tv.blofy.player.ui.search

/** Pure, bounded rules for two screens: conversation results link to LOCAL search. */
internal object AiChatRoutingPolicy {
    fun kinds(question: String): List<String> {
        val series = listOf("مسلسل", "مسلسلات", "series", "tv show", "shows").any {
            question.contains(it, ignoreCase = true)
        }
        val movies = listOf("فيلم", "أفلام", "افلام", "movie", "film").any {
            question.contains(it, ignoreCase = true)
        }
        return when {
            series && !movies -> listOf("series")
            movies && !series -> listOf("movie")
            else -> listOf("movie", "series")
        }
    }
    fun maySuggestAlternatives(question: String, person: String): Boolean {
        if (person.isNotBlank()) return false
        return listOf("رشح", "اقترح", "اعطني", "عطني", "أبي", "ابي",
            "ابغى", "recommend", "suggest", "show me", "watch").any {
            question.contains(it, ignoreCase = true)
        }
    }
}
