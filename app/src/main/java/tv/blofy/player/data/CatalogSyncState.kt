package tv.blofy.player.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.metadata.ProviderMetadataCache

/** Stores catalog readiness and the last successful refresh time per provider. */
object CatalogSyncState {
    private const val PREFS = "blofy_catalog_sync_state"
    private const val READY_PREFIX = "ready:"
    private const val METADATA_READY_PREFIX = "metadata_ready:"
    private const val EPISODES_READY_PREFIX = "episodes_ready:"
    private const val VERIFIED_PREFIX = "verified_v2:"
    private const val ENTRY_EPOCH_PREFIX = "entry_epoch_v1:"
    private const val UPDATED_PREFIX = "updated:"
    private const val METADATA_CHECKPOINT_PREFIX = "metadata_checkpoint:"
    private const val EPISODES_CHECKPOINT_PREFIX = "episodes_checkpoint:"
    private const val METADATA_KIND_PREFIX = "metadata_kind:"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(READY_PREFIX + providerId, false)

    /** Interrupted first-import batches are not a saved library that a failed refresh may reopen. */
    suspend fun discardUncommittedCatalog(context: Context, dao: BlofyDao, providerId: String) {
        if (!isReady(context, providerId)) dao.clearProviderCatalog(providerId)
    }

    fun isMetadataReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(METADATA_READY_PREFIX + providerId, false)

    fun areEpisodesReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(EPISODES_READY_PREFIX + providerId, false)

    /**
     * Entry is governed by the durable Room catalog, not by derived Home/manifest/search markers.
     * A successful catalog commit already persisted the provider and rows atomically. If the process
     * dies before secondary snapshots are marked ready, reopening must still use that local catalog
     * immediately instead of forcing another loading screen/network pass.
     */
    fun isEntryReady(context: Context, providerId: String): Boolean =
        providerId.isNotBlank() && lastUpdatedAt(context, providerId) > 0L && isReady(context, providerId)

    /** Secondary local accelerators are useful, but never a gate for opening a known-good catalog. */
    fun isEntryCachesReady(context: Context, providerId: String): Boolean {
        val epoch = lastUpdatedAt(context, providerId)
        if (epoch <= 0L || !isReady(context, providerId)) return false
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getLong(ENTRY_EPOCH_PREFIX + providerId, 0L) == epoch &&
            HomeSnapshotStore.read(context, providerId) != null &&
            CatalogManifestStore.read(context, providerId)?.let { it.entryReady && it.catalogEpoch == epoch } == true &&
            CatalogSearchIndex.isReady(context, providerId)
    }

    /**
     * Full readiness means there is no unresolved website/provider source replacement. This is
     * intentionally stricter than isEntryReady(): a pending replacement must not block reopening
     * the known-good local catalog, but callers that need the current source to be fully reconciled
     * still need a reliable distinction.
     */
    fun isFullyReady(context: Context, providerId: String): Boolean =
        isEntryReady(context, providerId) && !PortalSyncBook.hasPendingSource(context, providerId)

    fun lastUpdatedAt(context: Context, providerId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(UPDATED_PREFIX + providerId, 0L)

    fun lastSyncedAt(context: Context, providerId: String): Long = lastUpdatedAt(context, providerId)

    fun metadataCheckpoint(context: Context, providerId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(METADATA_CHECKPOINT_PREFIX + providerId, 0L)

    fun episodesCheckpoint(context: Context, providerId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(EPISODES_CHECKPOINT_PREFIX + providerId, 0L)

    fun metadataKind(context: Context, providerId: String): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(METADATA_KIND_PREFIX + providerId, "movie")
            ?.let { if (it == "series") "series" else "movie" } ?: "movie"

    fun markMetadataCheckpoint(context: Context, providerId: String, kind: String, rowId: Long) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(METADATA_KIND_PREFIX + providerId, if (kind == "series") "series" else "movie")
            .putLong(METADATA_CHECKPOINT_PREFIX + providerId, rowId.coerceAtLeast(0L)).apply()
    }

    fun markEpisodesCheckpoint(context: Context, providerId: String, rowId: Long) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(EPISODES_CHECKPOINT_PREFIX + providerId, rowId.coerceAtLeast(0L)).apply()
    }

    @Synchronized
    fun markPending(context: Context, providerId: String) {
        if (isReady(context, providerId)) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(ENTRY_EPOCH_PREFIX + providerId)
            .putBoolean(VERIFIED_PREFIX + providerId, false)
            .putBoolean(READY_PREFIX + providerId, false)
            .putBoolean(METADATA_READY_PREFIX + providerId, false)
            .putBoolean(EPISODES_READY_PREFIX + providerId, false)
            .putLong(METADATA_CHECKPOINT_PREFIX + providerId, 0L)
            .putLong(EPISODES_CHECKPOINT_PREFIX + providerId, 0L)
            .putString(METADATA_KIND_PREFIX + providerId, "movie").apply()
        HomeSnapshotStore.clear(context.applicationContext, providerId)
        CatalogManifestStore.clear(context.applicationContext, providerId)
    }

    fun markReady(context: Context, providerId: String) {
        if (isReady(context, providerId)) return
        markCatalogCommitted(context, providerId)
    }

    @Synchronized
    fun markCatalogCommitted(context: Context, providerId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val epoch = maxOf(System.currentTimeMillis(), prefs.getLong(UPDATED_PREFIX + providerId, 0L) + 1L)
        check(prefs.edit().putBoolean(READY_PREFIX + providerId, true)
            .putBoolean(METADATA_READY_PREFIX + providerId, false)
            .putBoolean(EPISODES_READY_PREFIX + providerId, false)
            .remove(ENTRY_EPOCH_PREFIX + providerId)
            .putBoolean(VERIFIED_PREFIX + providerId, false)
            .putLong(UPDATED_PREFIX + providerId, epoch).commit()) { "Unable to persist catalog state" }
    }

    suspend fun markSourceReplaced(context: Context, providerId: String) =
        withContext(NonCancellable + Dispatchers.IO) {
            markCatalogCommitted(context, providerId)
            HomeSnapshotStore.clear(context, providerId)
            CatalogManifestStore.clear(context, providerId)
            ProviderMetadataCache.clearProvider(context, providerId)
        }

    @Synchronized
    fun markEntryReady(context: Context, providerId: String, expectedEpoch: Long) {
        check(expectedEpoch > 0L && lastUpdatedAt(context, providerId) == expectedEpoch) { "Catalog changed during preparation" }
        check(isReady(context, providerId))
        check(HomeSnapshotStore.read(context, providerId) != null)
        check(CatalogManifestStore.read(context, providerId)?.let { it.entryReady && it.catalogEpoch == expectedEpoch } == true)
        check(CatalogSearchIndex.isReady(context, providerId))
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(ENTRY_EPOCH_PREFIX + providerId, expectedEpoch).commit()) { "Unable to persist entry readiness" }
    }

    fun markFullyReady(context: Context, providerId: String, expectedEpoch: Long) = markEntryReady(context, providerId, expectedEpoch)

    fun markMetadataReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(METADATA_READY_PREFIX + providerId, true)
            .putLong(METADATA_CHECKPOINT_PREFIX + providerId, 0L)
            .putString(METADATA_KIND_PREFIX + providerId, "movie").apply()
    }

    fun markEpisodesReady(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(EPISODES_READY_PREFIX + providerId, true)
            .putLong(EPISODES_CHECKPOINT_PREFIX + providerId, 0L).apply()
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(ENTRY_EPOCH_PREFIX + providerId).remove(VERIFIED_PREFIX + providerId).remove(READY_PREFIX + providerId).remove(METADATA_READY_PREFIX + providerId)
            .remove(EPISODES_READY_PREFIX + providerId).remove(UPDATED_PREFIX + providerId)
            .remove(METADATA_CHECKPOINT_PREFIX + providerId).remove(EPISODES_CHECKPOINT_PREFIX + providerId)
            .remove(METADATA_KIND_PREFIX + providerId).apply()
        HomeSnapshotStore.clear(context.applicationContext, providerId)
        CatalogManifestStore.clear(context.applicationContext, providerId)
    }
}
