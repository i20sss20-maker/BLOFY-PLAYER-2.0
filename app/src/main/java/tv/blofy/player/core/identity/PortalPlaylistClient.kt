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
        val remote = fetchRemote(endpoint, auth)
        val local = dao.allProviders().first()
        val localById = local.associateBy { it.id }
        val changed = linkedSetOf<String>()
        val remoteProviders = ArrayList<ProviderEntity>(remote.size)
        var remoteActive: ProviderEntity? = null

        remote.forEach { item ->
            val existing = localById[item.id]
            val next = ProviderEntity(
                id = item.id,
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
            if (contentChanged) changed += next.id

            // Persist portal playlists locally immediately. This makes the device cache the source
            // of truth for rendering and guarantees a transient portal/network failure never makes
            // a previously visible playlist disappear from the login screen.
            dao.upsertProvider(next.copy(enabled = if (item.active) true else existing?.enabled ?: false))
            if (item.active) remoteActive = next
        }

        val remoteIds = remote.mapTo(hashSetOf()) { it.id }
        // The explicit "refresh from website" action is read-only remotely. It must never
        // recreate site-deleted rows by uploading every unmatched local record.
        if (mode == SyncMode.MERGE_AND_UPLOAD) {
            local.filterNot { it.id in remoteIds }.forEach { provider ->
                try {
                    push(
                        endpoint,
                        auth,
                        provider.copy(enabled = provider.enabled && remoteActive == null)
                    )
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
        val merged = mergedById.values.sortedByDescending { it.updatedAt }
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
        push(endpoint, auth, provider)
    }

    private suspend fun fetchRemote(endpoint: String, auth: JSONObject): List<RemotePlaylist> {
        val request = Request.Builder()
            .url("$endpoint/api/v1/portal/playlists/list")
            .post(auth.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).awaitResponse().use { response ->
            if (!response.isSuccessful) error("portal_list_http_${response.code}")
            val root = JSONObject(response.body?.string().orEmpty())
            val items = root.optJSONArray("items") ?: JSONArray()
            return buildList {
                for (i in 0 until items.length()) {
                    val row = items.optJSONObject(i) ?: continue
                    val type = row.optString("providerType").lowercase()
                    val url = row.optString("baseUrl").trim()
                    val id = row.optString("id").trim()
                    if (id.isBlank() || type !in setOf("xtream", "m3u") || !PlaylistUrlPolicy.isValid(url)) continue
                    add(RemotePlaylist(
                        id = id,
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

    private suspend fun push(endpoint: String, auth: JSONObject, provider: ProviderEntity) {
        val body = JSONObject(auth.toString()).apply {
            put("id", provider.id)
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
        }
    }

    private data class RemotePlaylist(
        val id: String,
        val name: String,
        val providerType: String,
        val baseUrl: String,
        val username: String,
        val password: String,
        val active: Boolean,
        val updatedAt: Long
    )
}
