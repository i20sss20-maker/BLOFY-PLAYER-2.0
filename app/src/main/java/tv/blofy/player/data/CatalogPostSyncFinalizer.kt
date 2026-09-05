package tv.blofy.player.data

import android.content.Context

/** Kept for binary/source compatibility; finalization is awaited by FullCatalogPreparer. */
object CatalogPostSyncFinalizer {
    fun maybeFinalize(context: Context, providerId: String) = Unit
}
