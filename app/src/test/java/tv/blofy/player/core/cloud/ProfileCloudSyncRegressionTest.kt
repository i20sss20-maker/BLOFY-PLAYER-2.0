package tv.blofy.player.core.cloud

import android.app.Application
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
import tv.blofy.player.data.profile.ProfileLibraryStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ProfileCloudSyncRegressionTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    // Not a registered user profile, so store mutations do not launch real automatic network jobs.
    private val profileId = "cloud-regression"

    @Before fun setup() {
        listOf("blofy_profile_library_v1", "blofy_profile_cloud_state_v1").forEach {
            app.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit()
        }
        server = MockWebServer().also { it.start() }
    }

    @After fun cleanup() { server.shutdown() }

    @Test fun inFlightUploadPreservesLocalRemovalAndUnrelatedRemoteAddition() = runBlocking(Dispatchers.IO) {
        ProfileLibraryStore.setWatchlisted(app, "old", true, profileId)
        val incoming = ProfileLibraryStore.snapshotJson(app, profileId).apply {
            put("watchlist", JSONArray(listOf("old", "remote")))
        }
        val writeStarted = CountDownLatch(1)
        val allowWrite = CountDownLatch(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.method == "GET") return json(JSONObject()
                    .put("exists", true).put("revision", 1).put("payload", incoming))
                val uploaded = JSONObject(request.body.readUtf8()).getJSONObject("payload")
                writeStarted.countDown()
                check(allowWrite.await(5, TimeUnit.SECONDS))
                return json(JSONObject().put("revision", 2).put("payload", uploaded))
            }
        }
        val task = async { ProfileCloudSync.sync(app, server.url("/").toString(), profileId) }
        try {
            assertTrue(writeStarted.await(5, TimeUnit.SECONDS))
            ProfileLibraryStore.setWatchlisted(app, "old", false, profileId)
            ProfileLibraryStore.setWatchlisted(app, "new", true, profileId)
        } finally { allowWrite.countDown() }
        task.await()
        assertEquals(setOf("remote", "new"), ProfileLibraryStore.watchlist(app, profileId))
        assertEquals(2L, ProfileCloudSync.knownRevision(app, profileId))
    }

    @Test fun inFlightDownloadPreservesNewSettingAndRemoteItems() = runBlocking(Dispatchers.IO) {
        val getStarted = CountDownLatch(1)
        val allowGet = CountDownLatch(1)
        val incoming = ProfileLibraryStore.snapshotJson(app, profileId).apply {
            put("watchlist", JSONArray(listOf("remote")))
            put("settings", JSONObject().put("remoteSetting", true))
        }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                getStarted.countDown()
                check(allowGet.await(5, TimeUnit.SECONDS))
                return json(JSONObject().put("exists", true).put("revision", 1).put("payload", incoming))
            }
        }
        val task = async { ProfileCloudSync.sync(app, server.url("/").toString(), profileId) }
        try {
            assertTrue(getStarted.await(5, TimeUnit.SECONDS))
            ProfileLibraryStore.setSetting(app, "localSetting", true, profileId)
        } finally { allowGet.countDown() }
        task.await()
        assertEquals(setOf("remote"), ProfileLibraryStore.watchlist(app, profileId))
        assertEquals(mapOf("remoteSetting" to true, "localSetting" to true), ProfileLibraryStore.settings(app, profileId))
    }

    @Test fun publicAutomaticSyncEntrySerializesConcurrentRequests() = runBlocking(Dispatchers.IO) {
        val firstStarted = CountDownLatch(1)
        val allowFirst = CountDownLatch(1)
        val snapshot = ProfileLibraryStore.snapshotJson(app, profileId)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                firstStarted.countDown()
                check(allowFirst.await(5, TimeUnit.SECONDS))
                return json(JSONObject().put("exists", true).put("revision", 1).put("payload", snapshot))
            }
        }
        val first = async { ProfileCloudSync.sync(app, server.url("/").toString(), profileId) }
        val secondStarted = CountDownLatch(1)
        try {
            assertTrue(firstStarted.await(5, TimeUnit.SECONDS))
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS))
            val second = async {
                secondStarted.countDown()
                ProfileCloudSync.sync(app, server.url("/").toString(), profileId)
            }
            assertTrue(secondStarted.await(5, TimeUnit.SECONDS))
            assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
            allowFirst.countDown()
            first.await()
            second.await()
        } finally { allowFirst.countDown() }
    }

    private fun json(value: JSONObject) = MockResponse()
        .setHeader("Content-Type", "application/json").setBody(value.toString())
}
