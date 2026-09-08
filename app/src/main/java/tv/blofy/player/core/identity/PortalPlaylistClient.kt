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
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object PortalPlaylistClient {
    enum class SyncMode { MERGE_AND_UPLOAD, PULL_ONLY }

    data class SyncResult(
        val activeProvider: ProviderEntity?,
        val providers: List<ProviderEntity>,
        val changedProviderIds: Set<String>,
        val remoteCount: Int
    )

    data class SubscriberPreparation(
        val providerId: String,
        val sourceChanged: Boolean,
        val hadReadyCatalog: Boolean,
        val approvedSourceFingerprint: String? = null
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
        val remoteRows = fetchRemote(endpoint, auth).filterNot { it.id in pending || it.aliasIds.any(pending::contains) }
        val beforeMigration = supportedProviders(dao.allProviders().first())
        val tokens = beforeMigration.filter { BlofySubscriberClient.isLegacyProxy(it, endpoint) }.map { it.username } +
            remoteRows.filter { BlofySubscriberClient.isLegacyProxy(it.provider(), endpoint) }.map { it.username }
        val resolved = BlofySubscriberClient.resolveConnections(context, endpoint, tokens)
        for (provider in beforeMigration.filter { BlofySubscriberClient.isLegacyProxy(it, endpoint) }) {
            resolved[provider.username]?.let { migrateSubscriber(context, dao, provider, it) }
        }
        val remote = remoteRows.map { item ->
            if (!BlofySubscriberClient.isLegacyProxy(item.provider(), endpoint)) item else {
                val direct = checkNotNull(resolved[item.username]) { "أعد تسجيل الدخول إلى مشترك BLOFY" }
                item.copy(baseUrl = direct.baseUrl, username = direct.username, password = direct.password, subscriberToken = direct.sessionToken)
            }
        }
        val local = supportedProviders(dao.allProviders().first())
        val localById = local.associateBy { it.id }
        val changed = linkedSetOf<String>()
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
                updatedAt = item.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis(),
                subscriberToken = item.subscriberToken
            )
            // A subscriber account edit shares the proxy URL with the old account. Token renewal
            // is normally source-neutral, but must not bypass an already staged account change.
            val pendingSubscriberSource = existing != null && BlofySubscriberClient.isManaged(existing) &&
                PortalSyncBook.hasPendingSource(context, existing.id)
            val contentChanged = existing == null || !sameSource(existing, next) || pendingSubscriberSource
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
            // Keep the current selection stable while rows are reconciled. The one final
            // activation transaction below applies the site's selection without a two-active gap.
            dao.upsertProvider(visible.copy(enabled = existing?.enabled ?: false))
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

        val merged = supportedProviders(PortalSyncBook.visible(context, dao.allProviders().first())).sortedByDescending { it.updatedAt }
        val activeCandidate = remoteActive?.let { remoteChoice -> merged.firstOrNull { it.id == remoteChoice.id } }
            ?: merged.firstOrNull { it.enabled } ?: merged.firstOrNull()
        activeCandidate?.let { dao.activateExistingProvider(it.id) }
        val reconciled = supportedProviders(PortalSyncBook.visible(context, dao.allProviders().first())).sortedByDescending { it.updatedAt }
        SyncResult(reconciled.firstOrNull { it.enabled }, reconciled, changed, remote.size)
    }

    suspend fun selectProvider(context: Context, baseUrl: String, provider: ProviderEntity, dao: BlofyDao): ProviderEntity = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            require(provider.providerType.equals("xtream", true)) { "Xtream provider required" }
            val current = ensureSubscriberConnectionInternal(context, baseUrl, dao, provider.id)
                ?: error("Playlist no longer exists")
            check(PortalSyncBook.visible(context, listOf(current)).isNotEmpty()) { "Playlist was removed" }
            val selected = current.copy(
                enabled = true,
                providerType = "xtream",
                updatedAt = System.currentTimeMillis()
            )
            dao.saveAndActivateProvider(selected)
            val app = context.applicationContext
            if (baseUrl.isNotBlank()) backgroundScope.launch {
                syncMutex.withLock {
                    runCatching {
                        val latest = dao.provider(selected.id)?.takeIf {
                            it.enabled && PortalSyncBook.visible(app, listOf(it)).isNotEmpty()
                        } ?: return@runCatching
                        val remoteSelection = (pendingSource(app, dao, selected.id) ?: latest)
                            .copy(enabled = true, providerType = "xtream", updatedAt = latest.updatedAt)
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

    /** Keep a working subscriber catalog paired with its credentials until replacement commits. */
    suspend fun prepareSubscriberProvider(
        context: Context,
        baseUrl: String,
        dao: BlofyDao,
        provider: ProviderEntity,
        remoteId: String
    ): SubscriberPreparation = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            val existing = dao.provider(provider.id)
            val sameSubscriber = existing != null &&
                sameSource(existing, provider) &&
                (existing.id == remoteId || PortalSyncBook.remoteId(context, existing.id) == remoteId)
            // Binding may already point at an earlier pending account. A retry must not mistake
            // that binding for the identity of the still-visible, known-good catalog.
            val sourceChanged = !sameSubscriber || PortalSyncBook.hasPendingSource(context, provider.id)
            val ready = existing != null && CatalogSyncState.isReady(context, provider.id) && dao.hasCatalog(provider.id)
            val next = provider.copy(enabled = existing?.enabled ?: false)
            if (sourceChanged && ready) {
                val pendingId = PortalSyncBook.pendingSourceId(provider.id)
                PortalSyncBook.hide(context, setOf(pendingId))
                dao.upsertProvider(next.copy(id = pendingId, enabled = false))
                PortalSyncBook.markPendingSource(context, provider.id)
            } else {
                dao.upsertProvider(next)
                discardPendingSource(context, dao, provider.id)
                if (!ready) CatalogSyncState.markPending(context, provider.id)
            }
            PortalSyncBook.bind(context, provider.id, remoteId)
            try {
                // pushProvider() clears pending source state; this upload must retain it until
                // CatalogLoadingActivity validates and atomically commits the replacement.
                pushProviderInternal(context, baseUrl, next)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // The local save is durable and can connect even if portal mirroring is offline.
            }
            SubscriberPreparation(provider.id, sourceChanged, ready,
                approvedSourceFingerprint = if (sourceChanged && ready) sourceFingerprint(next) else null)
        }
    }

    suspend fun ensureSubscriberConnection(context: Context, endpoint: String, dao: BlofyDao, providerId: String): ProviderEntity? = syncMutex.withLock {
        withContext(Dispatchers.IO) { ensureSubscriberConnectionInternal(context, endpoint, dao, providerId) }
    }

    private suspend fun ensureSubscriberConnectionInternal(context: Context, endpoint: String, dao: BlofyDao, providerId: String): ProviderEntity? {
        val provider = dao.provider(providerId) ?: return null
        val candidates = listOfNotNull(provider, dao.provider(PortalSyncBook.pendingSourceId(providerId)))
            .filter { BlofySubscriberClient.isLegacyProxy(it, endpoint) }
        if (candidates.isEmpty()) return provider
        val resolved = BlofySubscriberClient.resolveConnections(context, endpoint, candidates.map { it.username })
        for (candidate in candidates) {
            val direct = checkNotNull(resolved[candidate.username]) { "أعد تسجيل الدخول إلى مشترك BLOFY" }
            migrateSubscriber(context, dao, candidate, direct)
        }
        return dao.provider(providerId)
    }

    private suspend fun migrateSubscriber(context: Context, dao: BlofyDao, provider: ProviderEntity, direct: BlofySubscriberClient.Session) {
        // Disposable detail metadata can contain artwork URLs from the previous proxy session.
        // Clear it before committing the transport change so interrupted upgrades retry safely.
        tv.blofy.player.data.metadata.ProviderMetadataCache.clearProvider(context, provider.id)
        check(dao.migrateSubscriberConnection(provider, provider.copy(baseUrl = direct.baseUrl, username = direct.username,
            password = direct.password, subscriberToken = direct.sessionToken))) { "تغيّرت القائمة أثناء تحديث اتصال BLOFY" }
    }

    /** Binds an explicit account-replacement action to one candidate without passing its secrets. */
    fun sourceFingerprint(provider: ProviderEntity): String {
        val digest = MessageDigest.getInstance("SHA-256")
        for (field in listOf(provider.id, provider.providerType, provider.baseUrl, provider.username, provider.password)) {
            val bytes = field.toByteArray(Charsets.UTF_8)
            digest.update(ByteBuffer.allocate(Int.SIZE_BYTES).putInt(bytes.size).array())
            digest.update(bytes)
        }
        return digest.digest().joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }

    /** A profile response may arrive after a source replacement, deletion, or another selection. */
    suspend fun mergeProviderProfile(
        context: Context,
        dao: BlofyDao,
        expected: ProviderEntity,
        expectedRemoteId: String,
        updated: ProviderEntity
    ): Boolean = syncMutex.withLock {
        withContext(Dispatchers.IO) {
            if (PortalSyncBook.remoteId(context, expected.id) != expectedRemoteId ||
                PortalSyncBook.visible(context, listOf(expected)).isEmpty()) return@withContext false
            dao.mergeProviderProfileIfSourceUnchanged(expected, updated)
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
        check(latest != null && sameSource(latest, expectedSource) &&
            latest.username == expectedSource.username && latest.password == expectedSource.password) {
            "Website source changed during preparation"
        }
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

    /** BLOFY subscriber tokens are renewable credentials for one stable providerId, not catalog identity. */
    internal fun sameSource(first: ProviderEntity, second: ProviderEntity): Boolean {
        if (!first.providerType.equals(second.providerType, true)) return false
        if (first.baseUrl.trimEnd('/') != second.baseUrl.trimEnd('/')) return false
        if (isBlofySubscriberProxy(first.baseUrl) && isBlofySubscriberProxy(second.baseUrl)) return true
        return first.username == second.username && first.password == second.password
    }

    private fun isBlofySubscriberProxy(baseUrl: String): Boolean = runCatching {
        val path = java.net.URI(baseUrl).path?.trimEnd('/').orEmpty()
        path == "/api/v1/subscribers/xtream"
    }.getOrDefault(false)

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
        val portal = BlofySubscriberClient.portalSource(provider, endpoint)
        val body = JSONObject(auth.toString()).apply {
            put("id", remoteId)
            put("name", provider.name)
            put("providerType", "xtream")
            put("baseUrl", portal.baseUrl.trimEnd('/'))
            put("username", portal.username)
            put("password", portal.password)
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
        val updatedAt: Long,
        val subscriberToken: String = ""
    ) {
        fun provider() = ProviderEntity(id, name, baseUrl, username, password, subscriberToken = subscriberToken)
    }
}
