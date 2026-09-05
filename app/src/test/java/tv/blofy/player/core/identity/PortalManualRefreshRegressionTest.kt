package tv.blofy.player.core.identity

import android.app.Application
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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
import java.lang.reflect.Proxy

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PortalManualRefreshRegressionTest {
    private lateinit var server: MockWebServer
    private val rows = linkedMapOf<String, ProviderEntity>()
    private val dao: BlofyDao = Proxy.newProxyInstance(BlofyDao::class.java.classLoader, arrayOf(BlofyDao::class.java)) { _, method, args ->
        when (method.name) {
            "allProviders" -> flowOf(rows.values.toList())
            "upsertProvider" -> { val provider = args!![0] as ProviderEntity; rows[provider.id] = provider; Unit }
            "toString" -> "ManualRefreshFakeDao"
            else -> error("Unexpected database method: ${method.name}")
        }
    } as BlofyDao

    @Before fun setup() { rows.clear(); server = MockWebServer(); server.start() }
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
