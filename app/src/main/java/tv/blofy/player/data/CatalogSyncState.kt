package tv.blofy.player.data

import android.content.Context

/** Stores catalog readiness and the last successful refresh time per provider. */
object CatalogSyncState {
    private const val PREFS = "blofy_catalog_sync_state"
    private const val READY_PREFIX = "ready:"
    private const val METADATA_READY_PREFIX = "metadata_ready:"
    private const val EPISODES_READY_PREFIX = "episodes_ready:"
    private const val VERIFIED_PREFIX = "verified_v2:"
    private const val UPDATED_PREFIX = "updated:"
    private const val METADATA_CHECKPOINT_PREFIX = "metadata_checkpoint:"
    private const val EPISODES_CHECKPOINT_PREFIX = "episodes_checkpoint:"
    private const val METADATA_KIND_PREFIX = "metadata_kind:"

    fun isReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(READY_PREFIX + providerId, false)
    fun isMetadataReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(METADATA_READY_PREFIX + providerId, false)
    fun areEpisodesReady(context: Context, providerId: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(EPISODES_READY_PREFIX + providerId, false)
    fun isFullyReady(context: Context, providerId: String): Boolean =
        isReady(context, providerId) && isMetadataReady(context, providerId) && areEpisodesReady(context, providerId) &&
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(VERIFIED_PREFIX + providerId, false)
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
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
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
    /** Compatibility entry: making the base catalog ready again never restarts preparation. */
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
            .putBoolean(VERIFIED_PREFIX + providerId, false)
            .putLong(UPDATED_PREFIX + providerId, epoch).commit()) { "Unable to persist catalog state" }
    }
    @Synchronized
    fun markFullyReady(context: Context, providerId: String, expectedEpoch: Long) {
        check(lastUpdatedAt(context, providerId) == expectedEpoch) { "Catalog changed during preparation" }
        check(isReady(context, providerId) && isMetadataReady(context, providerId) && areEpisodesReady(context, providerId))
        check(HomeSnapshotStore.read(context, providerId) != null)
        check(CatalogManifestStore.read(context, providerId)?.fullyReady == true)
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(VERIFIED_PREFIX + providerId, true).commit()) { "Unable to persist final readiness" }
    }
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
    /** Preparation is owned by CatalogLoadingActivity; never launch hidden post-login downloads. */
    fun resumeEnrichment(context: Context, providerId: String) = Unit
    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(VERIFIED_PREFIX + providerId).remove(READY_PREFIX + providerId).remove(METADATA_READY_PREFIX + providerId)
            .remove(EPISODES_READY_PREFIX + providerId).remove(UPDATED_PREFIX + providerId)
            .remove(METADATA_CHECKPOINT_PREFIX + providerId).remove(EPISODES_CHECKPOINT_PREFIX + providerId)
            .remove(METADATA_KIND_PREFIX + providerId).apply()
        HomeSnapshotStore.clear(context.applicationContext, providerId)
        CatalogManifestStore.clear(context.applicationContext, providerId)
    }
}
