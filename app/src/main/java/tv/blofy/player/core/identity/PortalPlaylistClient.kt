package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.core.url.PlaylistUrlPolicy
import java.util.concurrent.TimeUnit

object PortalPlaylistClient {
    data class SyncResult(
        val activeProviderId: String?,
        val changedProviderIds: Set<String>,
        val remoteCount: Int
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun sync(context: Context, baseUrl: String, dao: BlofyDao): SyncResult = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) return@withContext SyncResult(null, emptySet(), 0)

        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        val remote = fetchRemote(endpoint, auth)
        val local = dao.allProviders().first()
        val localById = local.associateBy { it.id }
        val changed = linkedSetOf<String>()
        var remoteActive: String? = null

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
            val contentChanged = existing == null ||
                existing.baseUrl != next.baseUrl || existing.username != next.username ||
                existing.password != next.password || existing.providerType != next.providerType
            if (existing != next) dao.upsertProvider(next)
            if (contentChanged) changed += next.id
            if (item.active) remoteActive = item.id
        }

        // Preserve local-only providers by publishing them to the portal after device authorization.
        val remoteIds = remote.mapTo(hashSetOf()) { it.id }
        local.filterNot { it.id in remoteIds }.forEach { provider ->
            runCatching { push(endpoint, auth, provider) }
        }

        if (remoteActive != null) {
            dao.disableAllProviders()
            dao.activateProvider(remoteActive!!)
        }
        val activeId = remoteActive ?: dao.providers().first().firstOrNull()?.id
        SyncResult(activeId, changed, remote.size)
    }

    suspend fun pushProvider(context: Context, baseUrl: String, provider: ProviderEntity) = withContext(Dispatchers.IO) {
        val endpoint = baseUrl.trim().trimEnd('/')
        if (endpoint.isBlank()) return@withContext
        require(PlaylistUrlPolicy.isValid(provider.baseUrl)) { "HTTPS playlist URL required" }
        val auth = JSONObject().apply {
            put("deviceId", DeviceIdentity.deviceId(context))
            put("activationCode", DeviceIdentity.activationCode(context))
        }
        push(endpoint, auth, provider)
    }

    private fun fetchRemote(endpoint: String, auth: JSONObject): List<RemotePlaylist> {
        val request = Request.Builder()
            .url("$endpoint/api/v1/portal/playlists/list")
            .post(auth.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().use { response ->
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

    private fun push(endpoint: String, auth: JSONObject, provider: ProviderEntity) {
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
        client.newCall(request).execute().use { response ->
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
