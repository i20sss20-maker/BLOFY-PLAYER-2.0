package tv.blofy.player.data

/**
 * Manual refresh is always staged. When saving or reconnecting credentials,
 * a previously fetched catalog must never be discarded just because an older
 * application build left the sync-ready preference false.
 */
internal object CatalogReusePolicy {
    fun canReuseSavedCatalog(hasCatalog: Boolean, connectionChanged: Boolean): Boolean =
        hasCatalog && !connectionChanged

    fun shouldStageReplacement(hasCatalog: Boolean, connectionChanged: Boolean): Boolean =
        hasCatalog && connectionChanged
}
