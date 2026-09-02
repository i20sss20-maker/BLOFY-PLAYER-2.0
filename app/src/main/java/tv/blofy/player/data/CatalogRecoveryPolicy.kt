package tv.blofy.player.data

/**
 * Catalogs are cache-first. Opening or returning to a screen must never trigger a network
 * re-download. Refresh is explicit from Settings or when the active playlist/provider changes.
 */
object CatalogRecoveryPolicy {
    fun shouldAutoRefresh(
        kind: String,
        itemCount: Int,
        attempted: Boolean,
        refreshInProgress: Boolean
    ): Boolean = false
}
