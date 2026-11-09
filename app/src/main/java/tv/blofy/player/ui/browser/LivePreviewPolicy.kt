package tv.blofy.player.ui.browser

/**
 * Limits implicit upstream live stream connections while browsing Android TV.
 * A focused row must remain selected before the player opens a source.
 */
internal object LivePreviewPolicy {
    const val FOCUS_DEBOUNCE_MS = 1100L

    fun shouldSchedule(
        previewEnabled: Boolean,
        locked: Boolean,
        alreadyPreviewing: Boolean
    ): Boolean = previewEnabled && !locked && !alreadyPreviewing
}
