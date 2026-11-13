package tv.blofy.player.ui.search

/** Bounded, in-memory follow-up context; never includes session tokens or source URLs. */
internal object AiConversationPolicy {
    private val continuation = Regex(
        """^(?:طيب|غير(?:ها|هم)?|ثاني|بعد|بعدها|زيد|كمان|واذا|وإذا|ورني|اعطني غير|ممكن غير|what about|another|more|instead|and also)\b""",
        RegexOption.IGNORE_CASE
    )
    private val recent = Regex(
        """(?:جديد|حديث|الأحدث|احدث|آخر إصدار|recent|newest|latest|new release)""",
        RegexOption.IGNORE_CASE
    )
    fun wantsRecent(query: String) = recent.containsMatchIn(query)
    fun prompt(previousQuestion: String?, currentQuestion: String): String {
        val current = currentQuestion.trim().take(160)
        val previous = previousQuestion?.trim().orEmpty()
        // Treat a complete new prompt independently; only explicit followups
        // retain a small amount of user-provided context for the intent parser.
        if (previous.isBlank() || !continuation.containsMatchIn(current))
            return current
        return ("Previous request: " + previous.take(55) + "; follow-up: " + current).take(160)
    }
}
