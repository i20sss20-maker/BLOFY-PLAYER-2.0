package tv.blofy.player.data.preparation

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import java.util.concurrent.ConcurrentHashMap

/** Keeps a completed Room write and its readiness bookkeeping together when the screen closes. */
internal class CatalogLoadPersistence(
    private val context: Context,
    private val dao: BlofyDao,
    private val expectedSource: ProviderEntity,
    private val importProviderId: String,
    private val firstLoad: Boolean,
) {
    private val providerId get() = expectedSource.id
    var catalogCommitted = false
        private set

    /** Called only after the loading screen leaves its initial read-only catalog check. */
    suspend fun prepareFirstImport() = withContext(Dispatchers.IO) {
        if (firstLoad) {
            if (CatalogSyncState.isReady(context, providerId)) {
                check(!dao.hasCatalog(providerId)) { "Catalog changed while starting the import" }
                CatalogSyncState.clear(context, providerId)
            }
            check(dao.discardUncommittedCatalogIfSourceUnchanged(expectedSource) {
                !CatalogSyncState.isReady(context, providerId)
            }) {
                "Playlist source changed while starting the import"
            }
        }
    }

    suspend fun commit(writeCatalog: suspend () -> Unit) {
        currentCoroutineContext().ensureActive()
        withContext(NonCancellable + Dispatchers.IO) {
            writeCatalog()
            // Set this inside the same context: cancellation at the return to Main must not erase a
            // successfully committed first import or skip invalidating the previous refresh caches.
            catalogCommitted = true
            if (firstLoad) CatalogSyncState.markCatalogCommitted(context, providerId)
            else CatalogSyncState.markSourceReplaced(context, providerId)
        }
    }

    suspend fun discardIfUncommitted() = withContext(NonCancellable + Dispatchers.IO) {
        if (!catalogCommitted) {
            if (firstLoad) {
                dao.discardUncommittedCatalogIfSourceUnchanged(expectedSource) {
                    !CatalogSyncState.isReady(context, providerId)
                }
            } else dao.discardStagedCatalog(importProviderId)
        }
    }

    companion object {
        private val foregroundLoads = ConcurrentHashMap<String, Mutex>()

        /** A replacement activity must wait for the canceled activity's database cleanup. */
        suspend fun <T> withProviderLock(providerId: String, block: suspend () -> T): T =
            foregroundLoads.getOrPut(providerId) { Mutex() }.withLock { block() }

        /** Stream batches left by process death do not qualify as a fallback library. */
        suspend fun hasCommittedCatalog(context: Context, dao: BlofyDao, providerId: String): Boolean {
            return CatalogSyncState.isReady(context, providerId) && dao.hasCatalog(providerId)
        }

        /** Only an explicit account choice may replace the old library with a smaller new one. */
        fun isApprovedSourceReplacement(
            forceRefresh: Boolean,
            pendingSource: ProviderEntity?,
            approvedFingerprint: String?,
        ): Boolean = forceRefresh && pendingSource != null && !approvedFingerprint.isNullOrBlank() &&
            approvedFingerprint == PortalPlaylistClient.sourceFingerprint(pendingSource)
    }
}
