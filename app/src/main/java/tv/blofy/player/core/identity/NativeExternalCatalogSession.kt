package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.FirstImportCheckpoint
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.PlaylistSyncPolicy
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.remote.ExternalXtreamCatalogTransport
import java.util.UUID

/**
 * Native catalog staging, not an alternative customer UI.
 * Keep the existing paid library selected until all external Home/player
 * routes have passed their integration gates.
 */
internal object NativeExternalCatalogSession {
    private val gate = Mutex()

    // QA and explicitly opted-in website STREAM releases only. PLAYER and
    // ordinary builds keep their existing activation behavior.
    fun qaEnabled(context: Context): Boolean =
        tv.blofy.player.BuildConfig.CODE_ONLY_LOGIN &&
            (context.packageName == "tv.blofy.player.v2.stream.qa" ||
                (tv.blofy.player.BuildConfig.UNIFIED_STREAM_RELEASE &&
                    context.packageName == "tv.blofy.player.v2.stream"))

    fun hasStaged(context: Context): Boolean =
        qaEnabled(context) && context.getSharedPreferences("blofy_connect_profile", Context.MODE_PRIVATE)
            .contains("native_stage_v1")

    suspend fun activeId(context: Context): String? = withContext(Dispatchers.IO) {
        if (!qaEnabled(context) || StreamCodeSession.isClaimed(context)) return@withContext null
        val profile = ExternalStreamConnectStore.loadStaged(context) ?: return@withContext null
        val dao = BlofyDatabase.get(context.applicationContext).dao()
        val row = dao.provider(profile.providerId)
        profile.providerId.takeIf {
            row?.enabled == true && row.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
                dao.activeProviderId() == it && CatalogSyncState.isReady(context,it) && dao.hasCatalog(it)
        }
    }

    suspend fun activatePrepared(context: Context, prepared: Prepared) = gate.withLock {
        withContext(Dispatchers.IO) {
            check(qaEnabled(context) && !StreamCodeSession.isClaimed(context))
            val profile = checkNotNull(ExternalStreamConnectStore.loadStaged(context))
            check(profile.providerId == prepared.providerId)
            val dao = BlofyDatabase.get(context.applicationContext).dao()
            val row = checkNotNull(dao.provider(prepared.providerId))
            check(row.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
                CatalogSyncState.isReady(context,row.id) && dao.hasCatalog(row.id))
            dao.activateExistingProvider(row.id)
        }
    }

    suspend fun checkActive(context: Context): ExternalStreamConnectVerifier.Result? {
        val id = activeId(context) ?: return null
        val profile = withContext(Dispatchers.IO) { ExternalStreamConnectStore.loadStaged(context) }
        if (profile?.providerId != id) return null
        return ExternalStreamConnectVerifier.verify(profile.credentials)
    }

    suspend fun signOut(context: Context) = gate.withLock {
        withContext(Dispatchers.IO) {
            val profile = ExternalStreamConnectStore.loadStaged(context)
            ExternalStreamConnectStore.clearStaged(context)
            tv.blofy.player.data.NativeExternalCatalogRefreshWorker.cancel(context)
            if (profile != null) {
                val dao = BlofyDatabase.get(context.applicationContext).dao()
                val row = dao.provider(profile.providerId)
                if (row?.baseUrl == ExternalXtreamCatalogTransport.ORIGIN) {
                    tv.blofy.player.ui.library.OfflineDownloadStore.removeNativeProvider(context,profile.providerId)
                    dao.deactivateProvider(profile.providerId)
                    dao.discardStagedCatalog(profile.providerId)
                    CatalogSyncState.clear(context,profile.providerId)
                    FirstImportCheckpoint.clear(context,profile.providerId)
                }
            }
        }
    }

    class Prepared(val providerId: String, val itemCount: Int)

    suspend fun prepare(
        context: Context,
        result: UnifiedStreamCodeClient.Result.External,
        onSaved: suspend () -> Unit = {},
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): Prepared = gate.withLock {
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            check(qaEnabled(app) && !StreamCodeSession.isClaimed(app))
            val credentials = result.credentials
            val previous = ExternalStreamConnectStore.loadStaged(app)
            val same = previous != null && previous.credentials.host == credentials.host &&
                previous.credentials.username == credentials.username &&
                previous.credentials.password == credentials.password
            val profile = if (same) checkNotNull(previous) else
                ExternalStreamConnectStore.StagedProfile("external-" + UUID.randomUUID(), credentials)
            val dao = BlofyDatabase.get(app).dao()
            if (previous != null && !same) {
                check(dao.activeProviderId() != previous.providerId) { "Active external session cannot be replaced here" }
            }
            // Persist the redeemed credential before any provider network call.
            ExternalStreamConnectStore.saveStaged(app, profile)
            onSaved()
            if (previous != null && !same) {
                val old = dao.provider(previous.providerId)
                if (old != null && !old.enabled && old.baseUrl == ExternalXtreamCatalogTransport.ORIGIN) {
                    dao.discardStagedCatalog(previous.providerId)
                    CatalogSyncState.clear(app, previous.providerId)
                    FirstImportCheckpoint.clear(app, previous.providerId)
                }
            }
            verify(profile.credentials)
            importStaged(app, profile, onProgress)
        }
    }

    suspend fun resume(
        context: Context,
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): Prepared? = gate.withLock {
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            val profile = ExternalStreamConnectStore.loadStaged(app) ?: return@withContext null
            verify(profile.credentials)
            importStaged(app, profile, onProgress)
        }
    }

    suspend fun refresh(
        context: Context,
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): Int = gate.withLock {
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            val id = checkNotNull(activeId(app))
            val profile = checkNotNull(ExternalStreamConnectStore.loadStaged(app))
            check(profile.providerId == id)
            verify(profile.credentials)
            check(tv.blofy.player.data.LocalStorageManager.prepareForCatalogRefresh(app))
            val dao = BlofyDatabase.get(app).dao()
            val current = checkNotNull(dao.provider(id))
            val staged = current.copy(id = UUID.randomUUID().toString(), enabled = false)
            try {
                dao.upsertProvider(staged)
                val result = PlaylistSyncPolicy.run {
                    PlaylistManager.forExternal(profile.credentials,dao).syncAll(staged,onProgress = onProgress)
                }
                check(result.failedSectionCount == 0 && result.freshItemCount > 0)
                check(activeId(app) == id)
                // The DAO validates catalog integrity and preserves favorites,
                // saved episodes and current provider selection atomically.
                withContext(kotlinx.coroutines.NonCancellable) {
                    dao.promoteStagedRefresh(staged.id,current.copy(updatedAt = System.currentTimeMillis()),
                        activateTarget = false,expectedSource = current)
                    CatalogSyncState.markSourceReplaced(app,id)
                }
                result.freshItemCount
            } finally {
                withContext(kotlinx.coroutines.NonCancellable) { dao.discardStagedCatalog(staged.id) }
            }
        }
    }

    private suspend fun verify(credentials: ExternalStreamConnectClient.Credentials) {
        when (ExternalStreamConnectVerifier.verify(credentials).status) {
            ExternalStreamConnectVerifier.Status.ACTIVE -> Unit
            ExternalStreamConnectVerifier.Status.INACTIVE -> error("الاشتراك غير نشط")
            ExternalStreamConnectVerifier.Status.UNAVAILABLE -> error("تعذر الاتصال بمزود الاشتراك")
        }
    }

    private suspend fun importStaged(
        app: Context,
        profile: ExternalStreamConnectStore.StagedProfile,
        onProgress: suspend (PlaylistSyncProgress) -> Unit
    ): Prepared {
        val dao = BlofyDatabase.get(app).dao()
        val id = profile.providerId
        val existing = dao.provider(id)
        if (existing != null) {
            check(existing.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
                existing.username.isEmpty() && existing.password.isEmpty()) { "Invalid staged provider" }
            if (CatalogSyncState.isReady(app, id) && dao.hasCatalog(id))
                return Prepared(id, dao.streamCountForProvider(id))
            check(!existing.enabled) { "Active library cannot be overwritten by staging" }
        }
        // Interrupted imports remain disabled and never replace the active paid catalog.
        CatalogSyncState.clear(app, id)
        CatalogSyncState.markPending(app, id)
        val source = existing ?: ProviderEntity(id, "BLOFY STREAM", ExternalXtreamCatalogTransport.ORIGIN,
            "", "", enabled = false, preferredTransport = "http", allowCrossProtocolRedirects = false)
        if (existing == null) {
            FirstImportCheckpoint.clear(app,id)
            dao.clearProviderCatalog(id)
            dao.upsertProvider(source)
        }
        // The random provider ID is authenticated together with the encrypted
        // credentials and reused only for the same account. It scopes checkpoints.
        val checkpoint = FirstImportCheckpoint.discardIncompleteSections(app,dao,source)
        val imported = try {
            PlaylistSyncPolicy.run {
                PlaylistManager.forExternal(profile.credentials, dao).syncAll(
                    source, completedSections = checkpoint.completed,
                    onSectionComplete = { FirstImportCheckpoint.markCompleted(app,source,it) },
                    onProgress = onProgress)
            }
        } catch (timeout: kotlinx.coroutines.TimeoutCancellationException) {
            // Preserve cancellation by the parent lifecycle, but surface an
            // expired import deadline to the login's existing resume action.
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            error("Catalog import timed out; retry from saved sections")
        }
        check(imported.failedSectionCount == 0 && imported.freshItemCount > 0 &&
            dao.hasCatalog(id)) { "تعذر تحميل مكتبة الاشتراك بالكامل" }
        check(ExternalStreamConnectStore.loadStaged(app)?.providerId == id)
        CatalogSyncState.markCatalogCommitted(app, id)
        FirstImportCheckpoint.clear(app,id)
        return Prepared(id, dao.streamCountForProvider(id))
    }
}
