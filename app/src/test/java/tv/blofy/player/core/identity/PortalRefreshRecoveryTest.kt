package tv.blofy.player.core.identity

import android.app.Application
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
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
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/** Synthetic lists against a local server; no production credentials. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PortalRefreshRecoveryTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    private val rows = linkedMapOf<String, ProviderEntity>()
    private val dao = Proxy.newProxyInstance(BlofyDao::class.java.classLoader, arrayOf(BlofyDao::class.java)) { _, method, args ->
        when (method.name) {
            "allProviders" -> flowOf(rows.values.toList())
            "provider" -> rows[args!![0] as String]
            "upsertProvider" -> { val p = args!![0] as ProviderEntity; rows[p.id] = p; Unit }
            "deleteProvider" -> { rows.remove(args!![0] as String); Unit }
            "deactivateProvider" -> { val id = args!![0] as String; rows[id]?.let { rows[id] = it.copy(enabled = false) }; Unit }
            "hasCatalog" -> false
            "activateExistingProvider" -> {
                val id = args!![0] as String
                rows.keys.toList().forEach { key -> rows[key] = rows.getValue(key).copy(enabled = key == id) }; Unit
            }
            else -> error("Unexpected DAO method ${method.name}")
        }
    } as BlofyDao
    private val transport = OkHttpClient.Builder().dns(object : okhttp3.Dns {
        override fun lookup(hostname: String): List<InetAddress> = listOf(InetAddress.getByName("127.0.0.1"))
    }).callTimeout(2, TimeUnit.SECONDS).followRedirects(false).build()
    private val endpoint get() = server.url("/").newBuilder().host("portal.example").build().toString()
    private fun local(id: String) = ProviderEntity(id, id, "https://provider.example", "user", "secret")
    private fun row(id: String, proxy: Boolean = false, token: String = "token") = JSONObject().apply {
        put("id", id); put("name", "قائمة $id"); put("providerType", "xtream")
        put("baseUrl", if (proxy) endpoint.trimEnd('/') + "/api/v1/subscribers/xtream" else "https://provider.example")
        put("username", if (proxy) token else "user"); put("password", if (proxy) "blofy" else "secret")
        put("active", !proxy); put("updatedAt", 2L)
    }
    private fun enqueue(vararg items: Any, corrupt: Int = 0) {
        val json = JSONObject().put("items", JSONArray(items.toList())).put("skippedCorrupt", corrupt)
        server.enqueue(MockResponse().setBody(json.toString()))
    }
    private fun pull(resolve: suspend (Collection<String>) -> Map<String, BlofySubscriberClient.Session> = { emptyMap() }) = runBlocking {
        PortalPlaylistClient.syncWithResolver(app, endpoint, dao, transport, resolve)
    }
    @Before fun setup() {
        app.getSharedPreferences("blofy_portal_reconciliation_v1", 0).edit().clear().commit()
        app.getSharedPreferences("blofy_catalog_sync_state", 0).edit().clear().commit()
        rows.clear(); server = MockWebServer(); server.start()
    }
    @After fun cleanup() { server.shutdown() }

    @Test fun invalidSiblingCannotStopValidXtreamOrDeleteAnyKnownLocalList() {
        rows["keep"] = local("keep"); PortalSyncBook.bind(app, "keep", "keep")
        enqueue(row("new"), row("bad").put("password", ""))
        val result = pull()
        assertEquals(1, result.remoteCount); assertEquals(1, result.deferredCount)
        assertEquals(setOf("keep", "new"), result.providers.map { it.id }.toSet())
        assertTrue(PortalSyncBook.isKnown(app, "keep")); assertEquals(1, server.requestCount)
    }
    @Test fun serverSkippedCorruptRowsAreNotAnEmptyDeletionSnapshot() {
        rows["keep"] = local("keep"); PortalSyncBook.bind(app, "keep", "keep")
        enqueue(corrupt = 1)
        val result = pull()
        assertEquals(0, result.remoteCount); assertEquals(1, result.deferredCount)
        assertEquals(listOf("keep"), result.providers.map { it.id }); assertTrue(rows.getValue("keep").enabled)
        assertFalse(PortalRefreshFeedback.result(app, result).startsWith("Updated"))
    }
    @Test fun invalidSubscriberTokenDoesNotBlockValidDirectOrSubscriberLists() {
        enqueue(row("plain"), row("good", true, "good_token"), row("bad", true, "bad_token"))
        val result = pull { tokens ->
            assertEquals(setOf("good_token", "bad_token"), tokens.toSet())
            mapOf("good_token" to BlofySubscriberClient.Session("BLOFY", "https://subscriber.example", "u", "p", 999999L, sessionToken = "good_token"))
        }
        assertEquals(2, result.remoteCount); assertEquals(1, result.deferredCount)
        assertEquals(setOf("plain", "good"), result.providers.map { it.id }.toSet())
        assertEquals("good_token", rows["good"]?.subscriberToken); assertFalse(rows.containsKey("bad"))
    }
    @Test fun resolverOutagePreservesOldListAndImportsIndependentXtream() {
        rows["old"] = local("old"); PortalSyncBook.bind(app, "old", "old")
        enqueue(row("plain"), row("managed", true))
        val result = pull { throw PortalRefreshFailure("SUB", 503) }
        assertEquals(1, result.remoteCount); assertEquals(1, result.deferredCount)
        assertEquals(setOf("plain", "old"), result.providers.map { it.id }.toSet())
    }
    @Test fun resolverAuthenticationDenialIsNotConvertedIntoPartialSuccess() {
        val saved = local("keep"); rows[saved.id] = saved
        enqueue(row("plain"), row("managed", true))
        val error = runCatching { pull { throw PortalRefreshFailure("SUB", 403) } }.exceptionOrNull()
        assertTrue(error is PortalRefreshFailure); assertEquals(mapOf("keep" to saved), rows)
    }
    @Test fun resolverCancellationDoesNotMutateAnyList() {
        val saved = local("keep"); rows[saved.id] = saved
        enqueue(row("plain"), row("managed", true))
        assertTrue(runCatching { pull { throw CancellationException("leaving screen") } }.exceptionOrNull() is CancellationException)
        assertEquals(mapOf("keep" to saved), rows)
    }
    @Test fun transient503RetriesTheSameReadOnceAndThenSucceeds() {
        server.enqueue(MockResponse().setResponseCode(503)); enqueue(row("new"))
        assertEquals(1, pull().remoteCount); assertEquals(2, server.requestCount)
        val a = server.takeRequest(); val b = server.takeRequest()
        assertEquals(a.path, b.path); assertEquals(a.body.readUtf8(), b.body.readUtf8())
    }
    @Test fun authenticationDenialDoesNotRetryOrEraseLocalLists() {
        val saved = local("keep"); rows[saved.id] = saved
        server.enqueue(MockResponse().setResponseCode(403).setBody("{\"error\":\"unauthorized_device\"}"))
        val error = runCatching { pull() }.exceptionOrNull()
        assertTrue(error is PortalRefreshFailure); assertEquals(1, server.requestCount)
        assertEquals(mapOf("keep" to saved), rows)
        assertTrue(PortalRefreshFeedback.failure(app, error!!).contains("[P-LIST-403]"))
    }
    @Test fun malformedRootAndHtmlNeverEraseListsOrProduceASuccess() {
        val saved = local("keep"); rows[saved.id] = saved
        for (body in listOf("<html>upstream</html>", "{}", "{\"items\":null}")) {
            server.enqueue(MockResponse().setBody(body))
            assertTrue(runCatching { pull() }.exceptionOrNull() is PortalRefreshFailure)
            assertEquals(mapOf("keep" to saved), rows)
        }
    }
    @Test fun duplicateIdsAreDeferredRatherThanOverwritingCredentialsTwice() {
        val saved = local("same"); rows[saved.id] = saved
        enqueue(row("same"), row("same").put("password", "other"))
        val result = pull()
        assertEquals(0, result.remoteCount); assertTrue(result.deferredCount > 0); assertEquals(saved, rows["same"])
    }
    @Test fun pullOnlyDoesNotReplayQueuedDeleteOrResurrectIt() {
        rows["gone"] = local("gone"); PortalSyncBook.queueDelete(app, "gone", setOf("gone"))
        enqueue(row("gone"), row("new"))
        val result = pull()
        assertEquals(listOf("new"), result.providers.map { it.id })
        assertEquals(1, server.requestCount); assertEquals("POST", server.takeRequest().method)
        assertTrue("gone" in PortalSyncBook.pending(app))
    }
    @Test fun missingProviderTypeCannotLookLikeAConfirmedDeletion() {
        val saved = local("keep"); rows[saved.id] = saved
        PortalSyncBook.bind(app, "keep", "keep")
        enqueue(JSONObject())
        val result = pull()
        assertEquals(1, result.deferredCount)
        assertEquals(listOf("keep"), result.providers.map { it.id })
        assertEquals(saved, rows["keep"])
    }
    @Test fun feedbackNeverDisplaysRawSecretsOrRequestUrls() {
        val secret = "123456 password=private https://provider.example/user/pw"
        for (error in listOf(Exception(secret), PortalRefreshFailure("AUTH", cause = Exception(secret)))) {
            val message = PortalRefreshFeedback.failure(app, error)
            assertFalse(message.contains("123456")); assertFalse(message.contains("private")); assertFalse(message.contains("https://"))
        }
    }
}
