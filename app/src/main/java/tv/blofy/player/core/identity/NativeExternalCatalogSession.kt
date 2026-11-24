package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import tv.blofy.player.data.CatalogSyncState
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

    class Prepared(val providerId: String, val itemCount: Int)

    suspend fun prepare(
        context: Context,
        result: UnifiedStreamCodeClient.Result.External,
        onProgress: suspend (PlaylistSyncProgress) -> Unit = {}
    ): Prepared = gate.withLock {
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            val credentials = result.credentials
            verify(credentials)
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
            ExternalStreamConnectStore.saveStaged(app, profile)
            if (previous != null && !same) {
                val old = dao.provider(previous.providerId)
                if (old != null && !old.enabled && old.baseUrl == ExternalXtreamCatalogTransport.ORIGIN) {
                    dao.discardStagedCatalog(previous.providerId)
                    CatalogSyncState.clear(app, previous.providerId)
                }
            }
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
            check(!existing.enabled && existing.baseUrl == ExternalXtreamCatalogTransport.ORIGIN &&
                existing.username.isEmpty() && existing.password.isEmpty()) { "Invalid staged provider" }
            if (CatalogSyncState.isReady(app, id) && dao.hasCatalog(id))
                return Prepared(id, dao.streamCountForProvider(id))
        }
        // Interrupted imports remain disabled and never replace the active paid catalog.
        CatalogSyncState.clear(app, id)
        CatalogSyncState.markPending(app, id)
        dao.clearProviderCatalog(id)
        val source = ProviderEntity(id, "BLOFY STREAM", ExternalXtreamCatalogTransport.ORIGIN,
            "", "", enabled = false, preferredTransport = "http", allowCrossProtocolRedirects = false)
        dao.upsertProvider(source)
        val imported = PlaylistSyncPolicy.run {
            PlaylistManager.forExternal(profile.credentials, dao).syncAll(source, onProgress = onProgress)
        }
        check(imported.failedSectionCount == 0 && imported.freshItemCount > 0 &&
            dao.hasCatalog(id)) { "تعذر تحميل مكتبة الاشتراك بالكامل" }
        check(ExternalStreamConnectStore.loadStaged(app)?.providerId == id)
        CatalogSyncState.markCatalogCommitted(app, id)
        return Prepared(id, dao.streamCountForProvider(id))
    }
}
