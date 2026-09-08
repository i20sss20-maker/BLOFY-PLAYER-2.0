package tv.blofy.player.core.identity

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
    private var failProviderDelete = false
    private val dao: BlofyDao = Proxy.newProxyInstance(BlofyDao::class.java.classLoader, arrayOf(BlofyDao::class.java)) { _, method, args ->
        when (method.name) {
            "allProviders" -> flowOf(rows.values.toList())
            "provider" -> rows[args!![0] as String]
            "upsertProvider" -> { val provider = args!![0] as ProviderEntity; rows[provider.id] = provider; Unit }
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
            // Local activation must complete while /list is still deliberately blocked. Previously
            // selectProvider waited on the same mutex as that network response.
            val selected = withTimeout(1_500L) { selection.await() }
            assertEquals("two", selected.id)
            assertEquals(listOf("two"), rows.values.filter { it.enabled }.map { it.id })
            assertEquals(1L, release.count)
            assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS))
            release.countDown()
            val refreshed = refresh.await()
            assertEquals("two", refreshed.activeProvider?.id)
            assertEquals(listOf("two"), rows.values.filter { it.enabled }.map { it.id })
            assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
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
}
