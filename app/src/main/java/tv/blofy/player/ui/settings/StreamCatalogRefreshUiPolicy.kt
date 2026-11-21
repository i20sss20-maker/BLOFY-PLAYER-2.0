package tv.blofy.player.ui.settings

/**
 * The catalog worker can process thousands of delta pages in the background.
 * UI spinners are brief manual feedback only; WorkManager's enqueued automatic
 * retries must NEVER masquerade as a blocking refresh in Settings.
 */
internal object StreamCatalogRefreshUiPolicy {
    const val FOREGROUND_SPINNER_MS = 25_000L

    fun showSpinner(manualRequested: Boolean, workInFlight: Boolean,
                    movedToBackground: Boolean): Boolean =
        manualRequested && workInFlight && !movedToBackground
}
