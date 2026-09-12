from pathlib import Path

ROOT = Path('.')
def edit(path, old, new):
    file = ROOT / path
    text = file.read_text()
    assert text.count(old) == 1, (path, old[:100], text.count(old))
    file.write_text(text.replace(old, new, 1))

p = 'app/src/main/java/tv/blofy/player/core/identity/PortalPlaylistClient.kt'
edit(p, 'import kotlinx.coroutines.CancellationException', '''import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.net.ProtocolException
import javax.net.ssl.SSLException''')
edit(p, '        val remoteCount: Int\n', '        val remoteCount: Int,\n        val deferredCount: Int = 0\n')
edit(p, '    private val jsonType = ', '''    // Retry list reads once, without redirecting device credentials elsewhere.
    private val listClient = client.newBuilder().callTimeout(8, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    private val jsonType = ''')
edit(p, '''        mode: SyncMode = SyncMode.MERGE_AND_UPLOAD
    ): SyncResult = syncMutex.withLock {
        syncInternal(context, baseUrl, dao, mode)
    }

    private suspend fun syncInternal(context: Context, baseUrl: String, dao: BlofyDao, mode: SyncMode): SyncResult = withContext(Dispatchers.IO) {''', '''        mode: SyncMode = SyncMode.MERGE_AND_UPLOAD
    ): SyncResult = syncMutex.withLock {
        syncInternal(context, baseUrl, dao, mode, listClient) { tokens ->
            BlofySubscriberClient.resolveConnections(context, baseUrl, tokens)
        }
    }

    /** Test the same reconciliation with local HTTP and subscriber fixtures. */
    internal suspend fun syncWithResolver(
        context: Context, baseUrl: String, dao: BlofyDao, transport: OkHttpClient = listClient,
        resolve: suspend (Collection<String>) -> Map<String, BlofySubscriberClient.Session>
    ): SyncResult = syncMutex.withLock {
        syncInternal(context, baseUrl, dao, SyncMode.PULL_ONLY, transport, resolve)
    }

    private suspend fun syncInternal(
        context: Context, baseUrl: String, dao: BlofyDao, mode: SyncMode, transport: OkHttpClient,
        resolve: suspend (Collection<String>) -> Map<String, BlofySubscriberClient.Session>
    ): SyncResult = withContext(Dispatchers.IO) {''')
edit(p, '        for (id in PortalSyncBook.pending(context)) {', '''        // Manual pull does not spend its deadline replaying queued write operations.
        for (id in if (mode == SyncMode.PULL_ONLY) emptySet() else PortalSyncBook.pending(context)) {''')
edit(p, '        val remoteRows = fetchRemote(endpoint, auth).filterNot { it.id in pending || it.aliasIds.any(pending::contains) }', '''        val snapshot = fetchRemote(endpoint, auth, transport)
        val remoteRows = snapshot.items.filterNot { it.id in pending || it.aliasIds.any(pending::contains) }''')
edit(p, '        val resolved = BlofySubscriberClient.resolveConnections(context, endpoint, tokens)', '''        // A stale BLOFY token must not block independent Xtream lists.
        val resolved = try {
            if (tokens.isEmpty()) emptyMap() else withTimeoutOrNull(8_000L) { resolve(tokens) }.orEmpty()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: PortalRefreshFailure) {
            if (failure.httpStatus in setOf(401, 403)) throw failure
            emptyMap()
        } catch (_: Exception) { emptyMap() }
        var deferred = snapshot.deferredCount''')
edit(p, '''        val remote = remoteRows.map { item ->
            if (!BlofySubscriberClient.isLegacyProxy(item.provider(), endpoint)) item else {
                val direct = checkNotNull(resolved[item.username]) { "أعد تسجيل الدخول إلى مشترك BLOFY" }
                item.copy(baseUrl = direct.baseUrl, username = direct.username, password = direct.password, subscriberToken = direct.sessionToken)
            }
        }''', '''        val remote = remoteRows.mapNotNull { item ->
            if (!BlofySubscriberClient.isLegacyProxy(item.provider(), endpoint)) item else {
                val direct = resolved[item.username]
                if (direct == null) { deferred++; null }
                else item.copy(baseUrl = direct.baseUrl, username = direct.username,
                    password = direct.password, subscriberToken = direct.sessionToken)
            }
        }
        currentCoroutineContext().ensureActive()''')
edit(p, '''        val remoteAllIds = remote.flatMap { it.aliasIds + it.id }.toSet()
        val siteDeleted = local.filter { PortalSyncBook.isKnown(context, it.id) &&
            PortalSyncBook.remoteId(context, it.id) !in remoteAllIds }''', '''        // An incomplete response is never evidence of deletion.
        val remoteAllIds = snapshot.allRemoteIds
        val siteDeleted = if (deferred > 0) emptyList() else local.filter { PortalSyncBook.isKnown(context, it.id) &&
            PortalSyncBook.remoteId(context, it.id) !in remoteAllIds }''')
edit(p, '        if (mode == SyncMode.MERGE_AND_UPLOAD) {', '        if (mode == SyncMode.MERGE_AND_UPLOAD && deferred == 0) {')
edit(p, '        SyncResult(reconciled.firstOrNull { it.enabled }, reconciled, changed, remote.size)', '        SyncResult(reconciled.firstOrNull { it.enabled }, reconciled, changed, remote.size, deferred)')
file = ROOT / p
text = file.read_text()
start = text.index('    private suspend fun fetchRemote(')
end = text.index('    private suspend fun push(', start)
text = text[:start] + '''    private data class RemoteSnapshot(
        val items: List<RemotePlaylist>, val allRemoteIds: Set<String>, val deferredCount: Int
    )

    private suspend fun fetchRemote(endpoint: String, auth: JSONObject, transport: OkHttpClient): RemoteSnapshot {
        val request = Request.Builder().url("$endpoint/api/v1/portal/playlists/list")
            .post(auth.toString().toRequestBody(jsonType)).build()
        repeat(2) { attempt ->
            try {
                transport.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) {
                        if (attempt == 0 && response.code in setOf(408, 500, 502, 503, 504)) {
                            response.close()
                            delay(300L)
                            return@repeat
                        }
                        throw PortalRefreshFailure("LIST", response.code)
                    }
                    val root = try { JSONObject(response.body?.string().orEmpty()) }
                        catch (error: org.json.JSONException) { throw PortalRefreshFailure("DATA", cause = error) }
                    return parseSnapshot(root)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: IOException) {
                currentCoroutineContext().ensureActive()
                if (attempt == 1 || error is SSLException || error is ProtocolException) throw error
                delay(300L)
            }
        }
        throw PortalRefreshFailure("LIST")
    }

    private fun parseSnapshot(root: JSONObject): RemoteSnapshot {
        val items = root.optJSONArray("items") ?: throw PortalRefreshFailure("DATA")
        val valid = mutableListOf<RemotePlaylist>()
        val allIds = linkedSetOf<String>()
        val seen = hashSetOf<String>()
        val duplicates = hashSetOf<String>()
        var deferred = root.optInt("skippedCorrupt", 0).coerceAtLeast(0)
        if (root.has("complete") && !root.optBoolean("complete")) deferred++
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i)
            if (row == null) { deferred++; continue }
            val id = (row.opt("id") as? String).orEmpty().trim()
            val aliasArray = row.optJSONArray("aliasIds")
            val aliases = if (aliasArray == null) emptyList() else (0 until aliasArray.length())
                .mapNotNull { aliasArray.opt(it) as? String }.filter(String::isNotBlank)
            if (id.isNotBlank()) allIds += id
            allIds += aliases
            if (id.isNotBlank() && !seen.add(id)) { duplicates += id; deferred++; continue }
            val type = (row.opt("providerType") as? String).orEmpty().lowercase()
            if (type != "xtream") continue
            val url = (row.opt("baseUrl") as? String).orEmpty().trim()
            val username = (row.opt("username") as? String).orEmpty()
            val password = (row.opt("password") as? String).orEmpty()
            if (id.isBlank() || username.isBlank() || password.isBlank() || !PlaylistUrlPolicy.isValid(url)) {
                deferred++; continue
            }
            valid += RemotePlaylist(id, aliases,
                (row.opt("name") as? String).orEmpty().ifBlank { "BLOFY Server" },
                url.trimEnd('/'), username, password, row.optBoolean("active"), row.optLong("updatedAt"))
        }
        return RemoteSnapshot(valid.filterNot { it.id in duplicates }, allIds, deferred)
    }

''' + text[end:]
file.write_text(text)
p = 'app/src/main/java/tv/blofy/player/core/identity/BlofySubscriberClient.kt'
edit(p, '        for (batch in tokens.filter(String::isNotBlank).distinct().chunked(20)) {', '''        // Malformed legacy tokens are deferred instead of poisoning the batch.
        for (batch in tokens.filter { it.length in 1..4096 && it.all { c ->
            c.code < 128 && (c.isLetterOrDigit() || c == '-' || c == '_')
        } }.distinct().chunked(20)) {''')
edit(p, '                check(response.isSuccessful) { "تعذر تحديث اتصال مشترك BLOFY" }', '                if (!response.isSuccessful) throw PortalRefreshFailure("SUB", response.code)')
edit(p, '                    resolved[token] = parseDirectSession(row)', '''                    // Keep valid accounts when another account response is incomplete.
                    runCatching { parseDirectSession(row) }.getOrNull()?.let { resolved[token] = it }''')
p = 'app/src/main/java/tv/blofy/player/ui/login/LoginActivity.kt'
edit(p, 'import tv.blofy.player.core.identity.PortalSyncBook', 'import tv.blofy.player.core.identity.PortalSyncBook\nimport tv.blofy.player.core.identity.PortalRefreshFeedback\nimport tv.blofy.player.core.identity.PortalRefreshFailure')
edit(p, '                withTimeout(20_000L) { refreshIdentityAndProvider(fromWebsite) }', '                withTimeout(if (fromWebsite) 40_000L else 20_000L) { refreshIdentityAndProvider(fromWebsite) }')
edit(p, '''            } catch (_: TimeoutCancellationException) {
                status.text = getString(R.string.refresh_site_failed)
                renderPlaylistLoadFailure()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                status.text = getString(R.string.refresh_site_failed)
                renderPlaylistLoadFailure()''', '''            } catch (error: TimeoutCancellationException) {
                status.text = PortalRefreshFeedback.failure(this@LoginActivity, error)
                renderPlaylistLoadFailure()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status.text = PortalRefreshFeedback.failure(this@LoginActivity, error)
                renderPlaylistLoadFailure()''')
edit(p, '''        val remote = withContext(Dispatchers.IO) {
            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
        }''', '''        val remote = try { withContext(Dispatchers.IO) {
            manager.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
        } } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { throw PortalRefreshFailure("AUTH", cause = error) }''')
edit(p, '''        sync.activeProvider?.let { applyRemoteProviderProfile(endpoint, dao, it.id) }
        // A website refresh updates data only. Entering a playlist is an explicit user action.''', '''        status.text = PortalRefreshFeedback.result(this, sync)
        // Optional hints cannot turn a saved playlist refresh into a failure.
        sync.activeProvider?.let { provider -> lifecycleScope.launch {
            runSuspendCatching { applyRemoteProviderProfile(endpoint, dao, provider.id) }
        } }
        // A website refresh updates data only. Entering a playlist is an explicit user action.''')
p = 'app/src/main/java/tv/blofy/player/ui/playlist/ProviderManagerActivity.kt'
edit(p, 'import tv.blofy.player.core.identity.ActivationRemoteClient', 'import tv.blofy.player.core.identity.ActivationRemoteClient\nimport tv.blofy.player.core.identity.PortalRefreshFeedback\nimport tv.blofy.player.core.identity.PortalRefreshFailure')
edit(p, '                val result = withTimeout(20_000L) {', '                val result = withTimeout(40_000L) {')
edit(p, '''                            val checked = activation.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                            check(checked.canUse()) { "device_activation_required" }''', '''                            val checked = try {
                                activation.refresh(ActivationRemoteClient.create(endpoint), BuildConfig.VERSION_NAME)
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) { throw PortalRefreshFailure("AUTH", cause = error) }
                            if (!checked.canUse()) throw PortalRefreshFailure("AUTH", 403)''')
edit(p, '                status.text = "تم التحديث من الموقع • ${result.remoteCount} قائمة"', '                status.text = PortalRefreshFeedback.result(this@ProviderManagerActivity, result)')
edit(p, '''            } catch (_: TimeoutCancellationException) {
                status.text = "انتهت مهلة التحديث • قوائمك محفوظة، حاول مرة أخرى"''', '''            } catch (error: TimeoutCancellationException) {
                status.text = PortalRefreshFeedback.failure(this@ProviderManagerActivity, error)''')
edit(p, '''            } catch (_: Exception) {
                status.text = "تعذر التحديث من الموقع • تحقق من الاتصال أو ربط الجهاز"''', '''            } catch (error: Exception) {
                status.text = PortalRefreshFeedback.failure(this@ProviderManagerActivity, error)''')
p = 'app/src/test/java/tv/blofy/player/core/identity/PortalManualRefreshRegressionTest.kt'
edit(p, '''        server.enqueue(MockResponse().setResponseCode(503))
        val error = runCatching { pull() }.exceptionOrNull()''', '''        repeat(2) { server.enqueue(MockResponse().setResponseCode(503)) }
        val error = runCatching { pull() }.exceptionOrNull()''')
