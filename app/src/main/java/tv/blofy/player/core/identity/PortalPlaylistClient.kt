package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.core.network.awaitResponse
import tv.blofy.player.core.url.PlaylistUrlPolicy
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
    private val client = OkHttpClient.Builder()
        .callTimeout(12, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun sync(
        context: Context,
        baseUrl: String,
        dao: BlofyDao,
        mode: SyncMode = SyncMode.MERGE_AND_UPLOAD
    ): SyncResult = syncMutex.withLock {
        syncInternal(context, baseUrl, dao, mode)
    }

    private suspend fun syncInternal(context: Context, baseUrl: String, dao: BlofyDao, mode: SyncMode): SyncResult = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) {
            val local = dao.allProviders().first()
            return@withContext SyncResult(local.firstOrNull { it.enabled }, local, emptySet(), 0)
        }

        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        // Deletion intent is durable before contacting the server. A retry cannot resurrect it.
        for (id in PortalSyncBook.pending(context)) {
            try { deleteRemote(endpoint, auth, id); PortalSyncBook.acknowledgeDelete(context, id) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Keep pending and suppressed until a later successful retry. */ }
        }
        val pending = PortalSyncBook.pending(context)
        val remote = fetchRemote(endpoint, auth).filterNot { it.id in pending || it.aliasIds.any(pending::contains) }
        val local = dao.allProviders().first()
        val localById = local.associateBy { it.id }
        val changed = linkedSetOf<String>()
        val remoteProviders = ArrayList<ProviderEntity>(remote.size)
        var remoteActive: ProviderEntity? = null

        remote.forEach { item ->
            val candidates = local.filter { it.id == item.id || it.id in item.aliasIds ||
                (PortalSyncBook.isKnown(context, it.id) && PortalSyncBook.remoteId(context, it.id) == item.id) }
            // Reuse the cached local ID; changing it would orphan favorites/resume/episode keys.
            val existing = candidates.firstOrNull { CatalogSyncState.isFullyReady(context, it.id) && dao.hasCatalog(it.id) }
                ?: candidates.firstOrNull { dao.hasCatalog(it.id) } ?: localById[item.id] ?: candidates.firstOrNull()
            val localId = existing?.id ?: item.id
            val aliases = (candidates.map { it.id } + item.aliasIds + item.id).toSet() - localId
            PortalSyncBook.bind(context, localId, item.id, aliases)
            aliases.forEach { dao.deactivateProvider(it) }
            val next = ProviderEntity(
                id = localId,
                name = item.name,
                baseUrl = if (item.providerType == "xtream") item.baseUrl.trimEnd('/') else item.baseUrl,
                username = item.username,
                password = item.password,
                providerType = item.providerType,
                liveFormat = existing?.liveFormat ?: "ts",
                preferredTransport = existing?.preferredTransport ?: "cronet",
                preferredEngine = existing?.preferredEngine ?: "media3",
                allowCrossProtocolRedirects = existing?.allowCrossProtocolRedirects ?: true,
                enabled = item.active,
                updatedAt = item.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis()
            )
            remoteProviders += next
            val contentChanged = existing == null ||
                existing.baseUrl != next.baseUrl || existing.username != next.username ||
                existing.password != next.password || existing.providerType != next.providerType
            if (contentChanged) {
                changed += next.id
                CatalogSyncState.markPending(context, next.id)
            }

            // Persist portal playlists locally immediately. This makes the device cache the source
            // of truth for rendering and guarantees a transient portal/network failure never makes
            // a previously visible playlist disappear from the login screen.
            dao.upsertProvider(next.copy(enabled = if (item.active) true else existing?.enabled ?: false))
            if (item.active) remoteActive = next
        }

        val remoteIds = remote.mapTo(hashSetOf()) { it.id }
        // The explicit "refresh from website" action is read-only remotely. It must never
        // recreate site-deleted rows by uploading every unmatched local record.
        // Only a fully parsed successful list can confirm a deletion on the website.
        val remoteAllIds = remote.flatMap { it.aliasIds + it.id }.toSet()
        val siteDeleted = local.filter { PortalSyncBook.isKnown(context, it.id) &&
            PortalSyncBook.remoteId(context, it.id) !in remoteAllIds }
        PortalSyncBook.hide(context, siteDeleted.map { it.id }.toSet())
        siteDeleted.forEach { dao.deactivateProvider(it.id) }
        if (mode == SyncMode.MERGE_AND_UPLOAD) {
            PortalSyncBook.visible(context, local).filterNot { PortalSyncBook.isKnown(context, it.id) || it.id in remoteIds }.forEach { provider ->
                try {
                    push(
                        endpoint,
                        auth,
                        provider.copy(enabled = provider.enabled && remoteActive == null)
                    ).also { remoteId -> PortalSyncBook.bind(context, provider.id, remoteId) }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Upload is best-effort. The local playlist remains valid and MUST stay visible.
                }
            }
        }

        // Keep local-only rows until a separate, verified identity/deletion reconciliation.
        // Never infer duplicates or permission to delete solely from a matching display name.
        val mergedById = linkedMapOf<String, ProviderEntity>()
        local.forEach { mergedById[it.id] = it }
        remoteProviders.forEach { remoteProvider ->
            val old = mergedById[remoteProvider.id]
            mergedById[remoteProvider.id] = remoteProvider.copy(
                enabled = remoteProvider.enabled || (old?.enabled == true && remoteActive == null)
            )
        }
        val merged = PortalSyncBook.visible(context, mergedById.values.toList()).sortedByDescending { it.updatedAt }
        val activeCandidate = remoteActive ?: merged.firstOrNull { it.enabled } ?: merged.firstOrNull()
        SyncResult(activeCandidate, merged, changed, remote.size)
    }

    suspend fun selectProvider(context: Context, baseUrl: String, provider: ProviderEntity, dao: BlofyDao) = withContext(Dispatchers.IO) {
        val selected = provider.copy(enabled = true, updatedAt = System.currentTimeMillis())
        // Local activation is authoritative for responsiveness. Portal sync is best-effort and
        // cannot block or undo a user's playlist selection.
        dao.saveAndActivateProvider(selected)
        runCatching { pushProvider(context, baseUrl, selected) }
        selected
    }

    suspend fun pushProvider(context: Context, baseUrl: String, provider: ProviderEntity) = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) return@withContext
        require(PlaylistUrlPolicy.isValid(provider.baseUrl)) { "Valid HTTP or HTTPS playlist URL required" }
        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        val remoteId = push(endpoint, auth, provider, PortalSyncBook.remoteId(context, provider.id))
        PortalSyncBook.bind(context, provider.id, remoteId)
    }

    suspend fun removeProvider(context: Context, baseUrl: String, provider: ProviderEntity, dao: BlofyDao): Boolean = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            val remoteId = PortalSyncBook.remoteId(context, provider.id)
            val ids = dao.allProviders().first().filter { it.id == provider.id ||
                PortalSyncBook.remoteId(context, it.id) == remoteId }.map { it.id }.toSet()
            PortalSyncBook.queueDelete(context, remoteId, ids)
            ids.forEach { dao.deactivateProvider(it) }
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
                    val url = row.optString("baseUrl").trim()
                    val id = row.optString("id").trim()
                    check(id.isNotBlank() && type in setOf("xtream", "m3u") && PlaylistUrlPolicy.isValid(url)) { "portal_invalid_row" }
                    add(RemotePlaylist(
                        id = id,
                        aliasIds = row.optJSONArray("aliasIds")?.let { aliases ->
                            (0 until aliases.length()).map { aliases.getString(it) }.filter(String::isNotBlank)
                        }.orEmpty(),
                        name = row.optString("name").ifBlank { "BLOFY Playlist" },
                        providerType = type,
                        baseUrl = url,
                        username = row.optString("username"),
                        password = row.optString("password"),
                        active = row.optBoolean("active"),
                        updatedAt = row.optLong("updatedAt")
                    ))
                }
            }
        }
    }

    private suspend fun push(endpoint: String, auth: JSONObject, provider: ProviderEntity, remoteId: String = provider.id): String {
        val body = JSONObject(auth.toString()).apply {
            put("id", remoteId)
            put("name", provider.name)
            put("providerType", provider.providerType)
            put("baseUrl", provider.baseUrl)
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

    private data class RemotePlaylist(
        val id: String,
        val aliasIds: List<String>,
        val name: String,
        val providerType: String,
        val baseUrl: String,
        val username: String,
        val password: String,
        val active: Boolean,
        val updatedAt: Long
    )
}
