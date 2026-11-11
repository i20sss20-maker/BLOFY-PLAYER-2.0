package tv.blofy.player.ui.details

/**
 * Localizes display text only; content keys, provider metadata, search records
 * and playback routes remain unchanged. Arabic supplied by the source always
 * wins over an unrelated English metadata title/plot.
 */
internal object ArabicDetailsPolicy {
    fun hasArabic(text: String?): Boolean = text.orEmpty().any { char ->
        char in '\u0600'..'\u06FF' || char in '\u0750'..'\u077F' || char in '\u08A0'..'\u08FF'
    }

    fun needsTranslation(text: String?): Boolean =
        !text.isNullOrBlank() && !hasArabic(text) && text.any { it in 'A'..'Z' || it in 'a'..'z' }

    fun preferredTitle(streamTitle: String, providerTitle: String?, arabic: Boolean): String {
        if (arabic) {
            if (hasArabic(streamTitle)) return streamTitle
            if (hasArabic(providerTitle)) return providerTitle.orEmpty()
        }
        return providerTitle?.takeIf(String::isNotBlank) ?: streamTitle
    }

    fun preferredOverview(sourcePlot: String?, providerOverview: String?, arabic: Boolean): String? {
        if (arabic) {
            if (hasArabic(sourcePlot)) return sourcePlot
            if (hasArabic(providerOverview)) return providerOverview
        }
        return providerOverview?.takeIf(String::isNotBlank)
            ?: sourcePlot?.takeIf(String::isNotBlank)
    }
}
