package tv.blofy.player.ui.details

/**
 * Pure opt-in gate for remote AI metadata translation. An old local ML Kit
 * setting does NOT satisfy the separate cloud consent.
 */
internal object CloudTranslationPolicy {
    fun shouldRequest(
        codeOnly: Boolean,
        arabicUi: Boolean,
        optedIn: Boolean,
        needsTranslation: Boolean,
        cached: Boolean
    ): Boolean = codeOnly && arabicUi && optedIn && needsTranslation && !cached
}
