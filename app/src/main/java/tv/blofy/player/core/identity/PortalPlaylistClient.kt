package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.CatalogRefreshWorker
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import java.util.concurrent.TimeUnit

object PortalPlaylistClient {
    enum class SyncMode { MERGE_AND_UPLOAD, PULL_ONLY }

    data class SyncResult(
        val activeProvider: ProviderEntity?,
        val providers: List<ProviderEntity>,
        val changedProviderIds: Set<String>,
        val remoteCount: Int
    )

    private val syncMutex = Mutex()
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder()
        .callTimeout(12, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    @Volatile private var lastSyncAt = 0L
    @Volatile private var lastSyncKey = ""
    @Volatile private var lastSyncResult: SyncResult? = null

    suspend fun sync(
        context: Context,
        baseUrl: String,
        dao: BlofyDao,
        mode: SyncMode = SyncMode.MERGE_AND_UPLOAD
    ): SyncResult = syncMutex.withLock {
        // LoginActivity can receive onCreate + onResume back-to-back. Treat those as one portal
        // transaction instead of serializing two identical network/Room merges behind the mutex.
        val key = "${baseUrl.trim().trimEnd('/')}|${mode.name}|${DeviceIdentity.deviceId(context)}"
        val now = System.currentTimeMillis()
        val cached = lastSyncResult
        if (cached != null && key == lastSyncKey && now - lastSyncAt <= STARTUP_SYNC_DEDUPE_MS) {
            return@withLock cached
        }
        syncInternal(context, baseUrl, dao, mode).also { result ->
            lastSyncKey = key
            lastSyncAt = System.currentTimeMillis()
            lastSyncResult = result
        }
    }

    private suspend fun syncInternal(context: Context, baseUrl: String, dao: BlofyDao, mode: SyncMode): SyncResult = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) {
            val local = supportedProviders(PortalSyncBook.visible(context, dao.allProviders().first()))
            return@withContext SyncResult(local.firstOrNull { it.enabled }, local, emptySet(), 0)
        }

        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        for (id in PortalSyncBook.pending(context)) {
            try { deleteRemote(endpoint, auth, id); PortalSyncBook.acknowledgeDelete(context, id) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { }
        }
        val pending = PortalSyncBook.pending(context)
        val remote = fetchRemote(endpoint, auth).filterNot { it.id in pending || it.aliasIds.any(pending::contains) }
        val local = supportedProviders(dao.allProviders().first())
        val localById = local.associateBy { it.id }
        val changed = linkedSetOf<String>()
        val remoteProviders = ArrayList<ProviderEntity>(remote.size)
        var remoteActive: ProviderEntity? = null

        remote.forEach { item ->
            val candidates = local.filter { it.id == item.id || it.id in item.aliasIds ||
                (PortalSyncBook.isKnown(context, it.id) && PortalSyncBook.remoteId(context, it.id) == item.id) }
            val existing = candidates.firstOrNull { CatalogSyncState.isFullyReady(context, it.id) && dao.hasCatalog(it.id) }
                ?: candidates.firstOrNull { dao.hasCatalog(it.id) } ?: localById[item.id] ?: candidates.firstOrNull()
            val existingHasCatalog = existing?.let { dao.hasCatalog(it.id) } == true
            val existingReadyCatalog = existingHasCatalog && existing != null && CatalogSyncState.isReady(context, existing.id)
            val localId = existing?.id ?: item.id
            val aliases = (candidates.map { it.id } + item.aliasIds + item.id).toSet() - localId
            PortalSyncBook.bind(context, localId, item.id, aliases)
            aliases.forEach { dao.deactivateProvider(it) }
            val next = ProviderEntity(
                id = localId,
                name = item.name,
                baseUrl = item.baseUrl.trimEnd('/'),
                username = item.username,
                password = item.password,
                providerType = "xtream",
                liveFormat = existing?.liveFormat ?: "ts",
                preferredTransport = existing?.preferredTransport ?: "cronet",
                preferredEngine = existing?.preferredEngine ?: "media3",
                allowCrossProtocolRedirects = existing?.allowCrossProtocolRedirects ?: true,
                enabled = item.active,
                updatedAt = item.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis()
            )
            val contentChanged = existing == null || !sameSource(existing, next)
            if (contentChanged) {
                if (!existingReadyCatalog) changed += next.id
                CatalogSyncState.markPending(context, next.id)
            }

            val visible = if (contentChanged && existing != null && existingReadyCatalog) {
                val pendingId = PortalSyncBook.pendingSourceId(next.id)
                PortalSyncBook.hide(context, setOf(pendingId))
                dao.upsertProvider(next.copy(id = pendingId, enabled = false))
                PortalSyncBook.markPendingSource(context, next.id)
                existing.copy(name = next.name, enabled = next.enabled, updatedAt = next.updatedAt)
            } else {
                discardPendingSource(context, dao, next.id)
                next
            }
            remoteProviders += visible
            dao.upsertProvider(visible.copy(enabled = if (item.active) true else existing?.enabled ?: false))
            if (contentChanged && existingReadyCatalog) {
                runCatching { CatalogRefreshWorker.enqueueNow(context.applicationContext, next.id) }
            }
            if (item.active) remoteActive = visible
        }

        val remoteIds = remote.mapTo(hashSetOf()) { it.id }
        val remoteAllIds = remote.flatMap { it.aliasIds + it.id }.toSet()
        val siteDeleted = local.filter { PortalSyncBook.isKnown(context, it.id) &&
            PortalSyncBook.remoteId(context, it.id) !in remoteAllIds }
        PortalSyncBook.hide(context, siteDeleted.map { it.id }.toSet())
        siteDeleted.forEach { dao.deactivateProvider(it.id); discardPendingSource(context, dao, it.id) }
        if (mode == SyncMode.MERGE_AND_UPLOAD) {
            PortalSyncBook.visible(context, local)
                .filter { it.providerType.equals("xtream", true) }
                .filterNot { PortalSyncBook.isKnown(context, it.id) || it.id in remoteIds }
                .forEach { provider ->
                    try {
                        push(endpoint, auth, provider.copy(enabled = provider.enabled && remoteActive == null))
                            .also { remoteId -> PortalSyncBook.bind(context, provider.id, remoteId) }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                    }
                }
        }

        val mergedById = linkedMapOf<String, ProviderEntity>()
        local.forEach { mergedById[it.id] = it }
        remoteProviders.forEach { remoteProvider ->
            val old = mergedById[remoteProvider.id]
            mergedById[remoteProvider.id] = remoteProvider.copy(
                enabled = remoteProvider.enabled || (old?.enabled == true && remoteActive == null)
            )
        }
        val merged = supportedProviders(PortalSyncBook.visible(context, mergedById.values.toList())).sortedByDescending { it.updatedAt }
        val activeCandidate = remoteActive ?: merged.firstOrNull { it.enabled } ?: merged.firstOrNull()
        SyncResult(activeCandidate, merged, changed, remote.size)
    }

    suspend fun selectProvider(context: Context, baseUrl: String, provider: ProviderEntity, dao: BlofyDao): ProviderEntity = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            require(provider.providerType.equals("xtream", true)) { "Xtream provider required" }
            val selected = (dao.provider(provider.id) ?: provider).copy(
                enabled = true,
                providerType = "xtream",
                updatedAt = System.currentTimeMillis()
            )
            dao.saveAndActivateProvider(selected)
            val app = context.applicationContext
            backgroundScope.launch {
                syncMutex.withLock {
                    runCatching {
                        val remoteSelection = (pendingSource(app, dao, selected.id) ?: selected)
                            .copy(enabled = true, providerType = "xtream", updatedAt = selected.updatedAt)
                        pushProviderInternal(app, baseUrl, remoteSelection)
                    }
                }
            }
            selected
        }
    }

    suspend fun pushProvider(context: Context, baseUrl: String, provider: ProviderEntity) = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            if (baseUrl.isBlank()) return@withContext
            pushProviderInternal(context, baseUrl, provider)
            discardPendingSource(context, BlofyDatabase.get(context).dao(), provider.id)
        }
    }

    private suspend fun pushProviderInternal(context: Context, baseUrl: String, provider: ProviderEntity) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) return
        require(provider.providerType.equals("xtream", true)) { "Xtream provider required" }
        require(provider.username.isNotBlank() && provider.password.isNotBlank()) { "Xtream credentials required" }
        require(PlaylistUrlPolicy.isValid(provider.baseUrl)) { "Valid HTTP or HTTPS server URL required" }
        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        val remoteId = push(endpoint, auth, provider.copy(providerType = "xtream", baseUrl = provider.baseUrl.trimEnd('/')), PortalSyncBook.remoteId(context, provider.id))
        PortalSyncBook.bind(context, provider.id, remoteId)
    }

    suspend fun pendingSource(context: Context, dao: BlofyDao, providerId: String): ProviderEntity? {
        if (!PortalSyncBook.hasPendingSource(context, providerId)) return null
        return dao.provider(PortalSyncBook.pendingSourceId(providerId))?.takeIf { it.providerType.equals("xtream", true) }?.copy(id = providerId)
    }

    suspend fun commitPendingSource(
        context: Context,
        dao: BlofyDao,
        expectedSource: ProviderEntity,
        commit: suspend () -> Unit,
    ) = syncMutex.withLock {
        val latest = pendingSource(context, dao, expectedSource.id)
        check(latest != null && sameSource(latest, expectedSource)) { "Website source changed during preparation" }
        withContext(NonCancellable + Dispatchers.IO) {
            commit()
            discardPendingSource(context, dao, expectedSource.id)
        }
    }

    private suspend fun discardPendingSource(context: Context, dao: BlofyDao, providerId: String) {
        if (!PortalSyncBook.hasPendingSource(context, providerId)) return
        PortalSyncBook.clearPendingSource(context, providerId)
        dao.deleteProvider(PortalSyncBook.pendingSourceId(providerId))
    }

    private fun sameSource(first: ProviderEntity, second: ProviderEntity): Boolean =
        first.baseUrl == second.baseUrl && first.username == second.username &&
            first.password == second.password && first.providerType.equals(second.providerType, true)

    suspend fun removeProvider(context: Context, baseUrl: String, provider: ProviderEntity, dao: BlofyDao): Boolean = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            val remoteId = PortalSyncBook.remoteId(context, provider.id)
            val ids = dao.allProviders().first().filter { it.id == provider.id ||
                PortalSyncBook.remoteId(context, it.id) == remoteId }.map { it.id }.toSet()
            PortalSyncBook.queueDelete(context, remoteId, ids)
            ids.forEach { dao.deactivateProvider(it); discardPendingSource(context, dao, it) }
            val endpoint = baseUrl.trim().trimEnd('/')
            if (endpoint.isBlank()) return@withContext false
            val auth = JSONObject().apply {
                put("deviceId", DeviceIdentity.deviceId(context)); put("activationCode", DeviceIdentity.activationCode(context))
            }
            try {
                deleteRemote(endpoint, auth, remoteId)
                PortalSyncBook.acknowledgeDelete(context, remoteId)
                true
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { false }
        }
    }

    private suspend fun deleteRemote(endpoint: String, auth: JSONObject, id: String) {
        val request = Request.Builder().url("$endpoint/api/v1/portal/playlists/$id")
            .delete(auth.toString().toRequestBody(jsonType)).build()
        client.newCall(request).awaitResponse().use { response ->
            check(response.isSuccessful || response.code == 404) { "portal_delete_failed" }
        }
    }

    private suspend fun fetchRemote(endpoint: String, auth: JSONObject): List<RemotePlaylist> {
        val request = Request.Builder()
            .url("$endpoint/api/v1/portal/playlists/list")
            .post(auth.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error("portal_list_http_${response.code}")
            val root = JSONObject(response.body?.string().orEmpty())
            val items = checkNotNull(root.optJSONArray("items")) { "portal_invalid_list" }
            return buildList {
                for (i in 0 until items.length()) {
                    val row = checkNotNull(items.optJSONObject(i)) { "portal_invalid_row" }
                    val type = row.optString("providerType").lowercase()
                    if (type != "xtream") continue
                    val url = row.optString("baseUrl").trim()
                    val id = row.optString("id").trim()
                    val username = row.optString("username")
                    val password = row.optString("password")
                    check(id.isNotBlank() && username.isNotBlank() && password.isNotBlank() && PlaylistUrlPolicy.isValid(url)) { "portal_invalid_row" }
                    add(RemotePlaylist(
                        id = id,
                        aliasIds = row.optJSONArray("aliasIds")?.let { aliases ->
                            (0 until aliases.length()).map { aliases.getString(it) }.filter(String::isNotBlank)
                        }.orEmpty(),
                        name = row.optString("name").ifBlank { "BLOFY Server" },
                        baseUrl = url.trimEnd('/'),
                        username = username,
                        password = password,
                        active = row.optBoolean("active"),
                        updatedAt = row.optLong("updatedAt")
                    ))
                }
            }
        }
    }

    private suspend fun push(endpoint: String, auth: JSONObject, provider: ProviderEntity, remoteId: String = provider.id): String {
        require(provider.providerType.equals("xtream", true)) { "Xtream provider required" }
        val body = JSONObject(auth.toString()).apply {
            put("id", remoteId)
            put("name", provider.name)
            put("providerType", "xtream")
            put("baseUrl", provider.baseUrl.trimEnd('/'))
            put("username", provider.username)
            put("password", provider.password)
            put("active", provider.enabled)
        }
        val request = Request.Builder()
            .url("$endpoint/api/v1/portal/playlists")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error("portal_save_http_${response.code}")
            val saved = JSONObject(response.body?.string().orEmpty())
            return saved.optString("id").ifBlank { remoteId }
        }
    }

    private fun supportedProviders(items: List<ProviderEntity>): List<ProviderEntity> =
        items.filter { it.providerType.equals("xtream", true) }

    private data class RemotePlaylist(
        val id: String,
        val aliasIds: List<String>,
        val name: String,
        val baseUrl: String,
        val username: String,
        val password: String,
        val active: Boolean,
        val updatedAt: Long
    )

    private const val STARTUP_SYNC_DEDUPE_MS = 3_000L
}
