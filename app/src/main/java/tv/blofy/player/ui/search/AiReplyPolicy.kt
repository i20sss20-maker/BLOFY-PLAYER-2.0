package tv.blofy.player.ui.search

/** Discard unsupported model claims before any answer reaches the subscriber. */
internal object AiReplyPolicy {
    private val unverifiableClaims = Regex(
        """(?:https?://|www\.|متوفر|موجود في السيرفر|قمت بالبحث|بحثت في|available on|available in|I found in your|in your playlist|verified in)""",
        RegexOption.IGNORE_CASE
    )
    fun safe(reply: String): String = reply
        .replace(Regex("""[\u0000-\u001F]+"""), " ")
        .trim().take(220).takeUnless { unverifiableClaims.containsMatchIn(it) }.orEmpty()
}
