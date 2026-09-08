package tv.blofy.player.core.identity

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.CatalogSyncState
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PortalManualRefreshRegressionTest {
    private lateinit var server: MockWebServer
    private val rows = linkedMapOf<String, ProviderEntity>()
    private val enabledDuringUpsert = mutableListOf<List<String>>()
    private var failProviderDelete = false
    private val dao: BlofyDao = Proxy.newProxyInstance(BlofyDao::class.java.classLoader, arrayOf(BlofyDao::class.java)) { _, method, args ->
        when (method.name) {
            "allProviders" -> flowOf(rows.values.toList())
            "provider" -> rows[args!![0] as String]
            "upsertProvider" -> {
                val provider = args!![0] as ProviderEntity
                rows[provider.id] = provider
                enabledDuringUpsert += rows.values.filter { it.enabled }.map { it.id }
                Unit
            }
            "deleteProvider" -> {
                check(!failProviderDelete) { "simulated cleanup failure" }
                rows.remove(args!![0] as String)
                Unit
            }
            "saveAndActivateProvider" -> {
                val selected = args!![0] as ProviderEntity
                rows.keys.toList().forEach { id -> rows[id] = checkNotNull(rows[id]).copy(enabled = false) }
                rows[selected.id] = selected.copy(enabled = true)
                Unit
            }
            "activateExistingProvider" -> {
                val id = args!![0] as String
                check(rows.containsKey(id))
                rows.keys.toList().forEach { key -> rows[key] = checkNotNull(rows[key]).copy(enabled = key == id) }
                Unit
            }
            "hasCatalog" -> rows.containsKey(args!![0] as String)
            "deactivateProvider" -> {
                val id = args!![0] as String
                rows[id]?.let { rows[id] = it.copy(enabled = false) }
                Unit
            }
            "toString" -> "ManualRefreshFakeDao"
            else -> error("Unexpected database method: ${method.name}")
        }
    } as BlofyDao

    @Before fun setup() {
        rows.clear()
        enabledDuringUpsert.clear()
        failProviderDelete = false
        RuntimeEnvironment.getApplication().getSharedPreferences("blofy_catalog_sync_state", 0).edit().clear().commit()
        RuntimeEnvironment.getApplication()
            .getSharedPreferences("blofy_portal_reconciliation_v1", 0)
            .edit()
            .clear()
            .commit()
        server = MockWebServer()
        server.start()
    }
    @After fun cleanup() { server.shutdown() }

    private fun provider(id: String, name: String = "My playlist") = ProviderEntity(
        id, name, "https://provider.example.com", "user", "password", "xtream",
        "ts", "cronet", "media3", true, true, 1L
    )

    private fun reply(vararg providers: ProviderEntity) {
        val items = JSONArray()
        providers.forEach { p -> items.put(JSONObject().apply {
            put("id", p.id); put("name", p.name); put("baseUrl", p.baseUrl)
            put("username", p.username); put("password", p.password); put("providerType", p.providerType)
            put("active", p.enabled); put("updatedAt", 2L)
        }) }
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(JSONObject().put("items", items).toString()))
    }

    private fun pull() = runBlocking {
        PortalPlaylistClient.sync(RuntimeEnvironment.getApplication(), server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
    }

    @Test fun pullsRenameWithoutInvalidatingTheContentCatalog() {
        rows["one"] = provider("one", "Old name")
        reply(provider("one", "Living room"))
        val result = pull()
        assertEquals("Living room", rows["one"]?.name)
        assertTrue(result.changedProviderIds.isEmpty())
        assertEquals(1, result.remoteCount)
        assertEquals(1, rows.size)
        assertEquals("/api/v1/portal/playlists/list", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }

    @Test fun changedCredentialsAreFlaggedForPreparationOnConnect() {
        rows["one"] = provider("one")
        reply(provider("one").copy(password = "new-password"))
        val result = pull()
        assertEquals(setOf("one"), result.changedProviderIds)
        assertEquals("new-password", rows["one"]?.password)
    }

    @Test fun changedReadySourceIsHiddenUntilVerifiedReplacementCommits() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("one")
        rows["one"] = original
        CatalogSyncState.markCatalogCommitted(app, "one")
        reply(original.copy(password = "new-password"))
        val result = PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        assertEquals("password", rows["one"]?.password)
        assertEquals("password", result.activeProvider?.password)
        assertEquals(listOf("one"), result.providers.map { it.id })
        assertTrue(CatalogSyncState.isReady(app, "one"))
        assertTrue(PortalSyncBook.hasPendingSource(app, "one"))
        val candidate = checkNotNull(PortalPlaylistClient.pendingSource(app, dao, "one"))
        assertEquals("new-password", candidate.password)

        // A failed staged import leaves both the old usable source and its retry candidate intact.
        assertTrue(runCatching {
            PortalPlaylistClient.commitPendingSource(app, dao, candidate) { error("incomplete import") }
        }.isFailure)
        assertEquals("password", rows["one"]?.password)
        assertTrue(PortalSyncBook.hasPendingSource(app, "one"))

        PortalPlaylistClient.commitPendingSource(app, dao, candidate) { rows["one"] = candidate.copy(enabled = true) }
        assertEquals("new-password", rows["one"]?.password)
        assertFalse(PortalSyncBook.hasPendingSource(app, "one"))
        assertFalse(rows.containsKey(PortalSyncBook.pendingSourceId("one")))
    }

    @Test fun staleSourceImportCannotReplaceANewerWebsiteChange() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("one")
        rows["one"] = original
        CatalogSyncState.markCatalogCommitted(app, "one")
        reply(original.copy(password = "first"))
        PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        val stale = checkNotNull(PortalPlaylistClient.pendingSource(app, dao, "one"))
        reply(original.copy(password = "second"))
        PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        var committed = false
        assertTrue(runCatching {
            PortalPlaylistClient.commitPendingSource(app, dao, stale) { committed = true }
        }.isFailure)
        assertFalse(committed)
        assertEquals("password", rows["one"]?.password)
        assertEquals("second", PortalPlaylistClient.pendingSource(app, dao, "one")?.password)
    }

    @Test fun selectingPendingSourceDoesNotUploadOldCredentialsOverWebsiteEdit() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("one")
        rows["one"] = original
        CatalogSyncState.markCatalogCommitted(app, "one")
        reply(original.copy(password = "new-password"))
        PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        server.takeRequest()
        server.enqueue(MockResponse().setBody("{}"))
        val selected = PortalPlaylistClient.selectProvider(app, server.url("/").toString(), original, dao)
        assertEquals("password", selected.password)
        val uploaded = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("new-password", uploaded.getString("password"))
        assertEquals("password", rows["one"]?.password)
        assertTrue(PortalSyncBook.hasPendingSource(app, "one"))
    }

    @Test fun candidateCleanupFailureCannotLeaveCompletedSourceBlockedOrVisibleOffline() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("one")
        rows["one"] = original
        CatalogSyncState.markCatalogCommitted(app, "one")
        reply(original.copy(password = "new-password"))
        PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)
        val candidate = checkNotNull(PortalPlaylistClient.pendingSource(app, dao, "one"))
        failProviderDelete = true
        assertTrue(runCatching {
            PortalPlaylistClient.commitPendingSource(app, dao, candidate) { rows["one"] = candidate.copy(enabled = true) }
        }.isFailure)
        assertFalse(PortalSyncBook.hasPendingSource(app, "one"))
        assertEquals("new-password", rows["one"]?.password)
        assertTrue(rows.containsKey(PortalSyncBook.pendingSourceId("one")))
        val offline = PortalPlaylistClient.sync(app, "", dao)
        assertEquals(listOf("one"), offline.providers.map { it.id })
        assertEquals("one", offline.activeProvider?.id)
    }

    @Test fun explicitSelectionWinsOverAnAlreadyInFlightWebsiteList() = runBlocking(Dispatchers.IO) {
        val app = RuntimeEnvironment.getApplication()
        rows["one"] = provider("one")
        rows["two"] = provider("two").copy(enabled = false)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val selectedStarted = CountDownLatch(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path?.endsWith("/list") != true) return MockResponse().setBody("{}")
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                val items = JSONArray().apply {
                    for (id in listOf("one", "two")) put(JSONObject().apply {
                        put("id", id); put("name", id); put("baseUrl", "https://provider.example.com")
                        put("username", "user"); put("password", "password"); put("providerType", "xtream")
                        put("active", id == "one"); put("updatedAt", 2L)
                    })
                }
                return MockResponse().setBody(JSONObject().put("items", items).toString())
            }
        }
        val refresh = async { PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY) }
        try {
            assertTrue(started.await(5, TimeUnit.SECONDS))
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS))
            val selection = async {
                selectedStarted.countDown()
                PortalPlaylistClient.selectProvider(app, server.url("/").toString(), provider("two"), dao)
            }
            assertTrue(selectedStarted.await(5, TimeUnit.SECONDS))
            assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
            release.countDown()
            refresh.await()
            selection.await()
            assertEquals(listOf("two"), rows.values.filter { it.enabled }.map { it.id })
        } finally { release.countDown() }
    }

    @Test fun repeatingRefreshUpdatesSameIdInsteadOfInsertingAgain() {
        reply(provider("one")); pull()
        reply(provider("one")); val result = pull()
        assertEquals(1, rows.size)
        assertTrue(result.changedProviderIds.isEmpty())
        assertEquals(2, server.requestCount)
    }

    @Test fun manualRefreshNeverUploadsLocalOnlyRows() {
        rows["local-only"] = provider("local-only")
        reply(provider("website"))
        val result = pull()
        assertEquals(1, server.requestCount)
        assertEquals(setOf("local-only", "website"), rows.keys)
        assertEquals("website", result.activeProvider?.id)
    }

    @Test fun emptyRemoteListDoesNotDestroyLocalLists() {
        val original = provider("local-only")
        rows[original.id] = original
        reply()
        val result = pull()
        assertEquals(0, result.remoteCount)
        assertEquals(original, rows[original.id])
        assertEquals(1, server.requestCount)
    }

    @Test fun failedNetworkResponseLeavesSavedListsUntouched() {
        val original = provider("one")
        rows[original.id] = original
        server.enqueue(MockResponse().setResponseCode(503))
        val error = runCatching { pull() }.exceptionOrNull()
        assertNotNull(error)
        assertEquals(original, rows[original.id])
        assertEquals(1, rows.size)
    }

    @Test fun defaultSyncKeepsExistingUploadBehavior() = runBlocking {
        rows["local-only"] = provider("local-only")
        reply()
        server.enqueue(MockResponse().setBody("{}"))
        PortalPlaylistClient.sync(RuntimeEnvironment.getApplication(), server.url("/").toString(), dao)
        assertEquals(2, server.requestCount)
        assertEquals("/api/v1/portal/playlists/list", server.takeRequest().path)
        assertEquals("/api/v1/portal/playlists", server.takeRequest().path)
    }

    @Test fun editingSubscriberAccountKeepsWorkingCredentialsUntilValidatedCommit() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("local-subscriber").copy(
            baseUrl = "https://portal.example/api/v1/subscribers/xtream",
            username = "original-token", enabled = false
        )
        rows[original.id] = original
        rows["currently-playing"] = provider("currently-playing")
        PortalSyncBook.bind(app, original.id, "original-account")
        CatalogSyncState.markCatalogCommitted(app, original.id)
        val candidate = original.copy(username = "new-account-token")

        val prepared = PortalPlaylistClient.prepareSubscriberProvider(app, "", dao, candidate, "new-account")

        assertTrue(prepared.sourceChanged)
        assertTrue(prepared.hadReadyCatalog)
        assertEquals(PortalPlaylistClient.sourceFingerprint(candidate), prepared.approvedSourceFingerprint)
        assertEquals(original, rows[original.id])
        assertEquals("new-account-token", PortalPlaylistClient.pendingSource(app, dao, original.id)?.username)
        assertEquals(listOf("currently-playing"), rows.values.filter { it.enabled }.map { it.id })
        assertTrue(CatalogSyncState.isEntryReady(app, original.id))
        assertEquals(setOf(original.id, "currently-playing"), PortalSyncBook.visible(app, rows.values.toList()).map { it.id }.toSet())

        assertTrue(runCatching {
            PortalPlaylistClient.commitPendingSource(app, dao, candidate) { error("catalog validation failed") }
        }.isFailure)
        assertEquals(original, rows[original.id])
        assertTrue(PortalSyncBook.hasPendingSource(app, original.id))
    }

    @Test fun sameSubscriberTokenRenewalKeepsCatalogReadyWithoutAReplacement() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("subscriber").copy(baseUrl = "https://portal.example/api/v1/subscribers/xtream")
        rows[original.id] = original
        PortalSyncBook.bind(app, original.id, "same-account")
        CatalogSyncState.markCatalogCommitted(app, original.id)
        val epoch = CatalogSyncState.lastUpdatedAt(app, original.id)

        val prepared = PortalPlaylistClient.prepareSubscriberProvider(app, "", dao, original.copy(username = "renewed-token"), "same-account")

        assertFalse(prepared.sourceChanged)
        assertTrue(prepared.hadReadyCatalog)
        assertNull(prepared.approvedSourceFingerprint)
        assertEquals("renewed-token", rows[original.id]?.username)
        assertFalse(PortalSyncBook.hasPendingSource(app, original.id))
        assertEquals(epoch, CatalogSyncState.lastUpdatedAt(app, original.id))
        assertEquals(1, rows.size)
    }

    @Test fun retryingPendingSubscriberChangeCannotOverwriteWorkingOrNewerCandidateCredentials() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("subscriber").copy(
            baseUrl = "https://portal.example/api/v1/subscribers/xtream", username = "working-token"
        )
        rows[original.id] = original
        PortalSyncBook.bind(app, original.id, "old-account")
        CatalogSyncState.markCatalogCommitted(app, original.id)
        PortalPlaylistClient.prepareSubscriberProvider(app, "", dao, original.copy(username = "first-token"), "new-account")
        val first = checkNotNull(PortalPlaylistClient.pendingSource(app, dao, original.id))
        val retried = PortalPlaylistClient.prepareSubscriberProvider(app, "", dao, original.copy(username = "second-token"), "new-account")

        assertTrue(retried.sourceChanged)
        assertNotEquals(PortalPlaylistClient.sourceFingerprint(first), retried.approvedSourceFingerprint)
        assertEquals(PortalPlaylistClient.sourceFingerprint(checkNotNull(PortalPlaylistClient.pendingSource(app, dao, original.id))), retried.approvedSourceFingerprint)
        assertEquals("working-token", rows[original.id]?.username)
        assertEquals("second-token", PortalPlaylistClient.pendingSource(app, dao, original.id)?.username)
        var committed = false
        assertTrue(runCatching {
            PortalPlaylistClient.commitPendingSource(app, dao, first) { committed = true }
        }.isFailure)
        assertFalse(committed)
        assertTrue(PortalSyncBook.hasPendingSource(app, original.id))
    }

    @Test fun staleSelectionCannotResurrectADeletedOrHiddenPlaylist() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val removed = provider("removed")
        rows["active"] = provider("active")
        assertTrue(runCatching { PortalPlaylistClient.selectProvider(app, "", removed, dao) }.isFailure)
        assertFalse(rows.containsKey(removed.id))
        rows[removed.id] = removed.copy(enabled = false)
        PortalSyncBook.hide(app, setOf(removed.id))
        assertTrue(runCatching { PortalPlaylistClient.selectProvider(app, "", removed, dao) }.isFailure)
        assertEquals(listOf("active"), rows.values.filter { it.enabled }.map { it.id })
        assertEquals(0, server.requestCount)
    }

    @Test fun websiteRefreshCannotBypassAPendingSubscriberAccountReplacement() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val original = provider("local-subscriber").copy(
            baseUrl = "https://portal.example/api/v1/subscribers/xtream", username = "old-account-token"
        )
        rows[original.id] = original
        PortalSyncBook.bind(app, original.id, "old-account")
        CatalogSyncState.markCatalogCommitted(app, original.id)
        PortalPlaylistClient.prepareSubscriberProvider(app, "", dao, original.copy(username = "new-account-token"), "new-account")
        reply(original.copy(id = "new-account", username = "refreshed-new-account-token"))

        val synced = PortalPlaylistClient.sync(app, server.url("/").toString(), dao, PortalPlaylistClient.SyncMode.PULL_ONLY)

        assertEquals("old-account-token", rows[original.id]?.username)
        assertEquals("old-account-token", synced.activeProvider?.username)
        assertTrue(PortalSyncBook.hasPendingSource(app, original.id))
        assertEquals("refreshed-new-account-token", PortalPlaylistClient.pendingSource(app, dao, original.id)?.username)
    }

    @Test fun websiteSelectionIsExclusiveDuringReconciliationAndInReturnedRows() {
        rows["old"] = provider("old")
        rows["new"] = provider("new").copy(enabled = false)
        reply(provider("old").copy(enabled = false), provider("new"))

        val synced = pull()

        assertEquals(listOf("new"), rows.values.filter { it.enabled }.map { it.id })
        assertEquals(listOf("new"), synced.providers.filter { it.enabled }.map { it.id })
        assertEquals("new", synced.activeProvider?.id)
        assertTrue(enabledDuringUpsert.all { it.size <= 1 })
    }

    @Test fun absentWebsiteSelectionKeepsTheExistingLocalChoice() {
        rows["chosen"] = provider("chosen")
        rows["other"] = provider("other").copy(enabled = false)
        reply(provider("chosen").copy(enabled = false), provider("other").copy(enabled = false))

        val synced = pull()

        assertEquals(listOf("chosen"), rows.values.filter { it.enabled }.map { it.id })
        assertEquals("chosen", synced.activeProvider?.id)
    }

    @Test fun deletedWebsiteSelectionIsNotReactivatedFromTheOldSnapshot() {
        val app = RuntimeEnvironment.getApplication()
        rows["deleted"] = provider("deleted")
        rows["local"] = provider("local").copy(enabled = false)
        PortalSyncBook.bind(app, "deleted", "deleted")
        reply()

        val synced = pull()

        assertFalse(checkNotNull(rows["deleted"]).enabled)
        assertEquals(listOf("local"), synced.providers.map { it.id })
        assertEquals("local", synced.activeProvider?.id)
        assertEquals(listOf("local"), rows.values.filter { it.enabled }.map { it.id })
    }
}
