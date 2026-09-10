package tv.blofy.player.ui.playlist

import android.app.Application
import android.content.pm.PackageManager
import android.os.Looper
import android.widget.Button
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.home.HomeActivity
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w1280dp-h720dp-land")
@LooperMode(LooperMode.Mode.PAUSED)
class ProviderManagerSelectionRegressionTest {
    private lateinit var db: BlofyDatabase
    private var controller: ActivityController<ProviderManagerActivity>? = null
    private val app get() = RuntimeEnvironment.getApplication()
    private val activity get() = checkNotNull(controller).get()
    private val first = ProviderEntity("first", "First", "https://example.test", "first-user", "secret")
    private val second = first.copy(id = "second", name = "Second", username = "second-user", enabled = false)
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previousDatabase: Any? = null

    @Before fun setup() {
        shadowOf(app.packageManager).setSystemFeature(PackageManager.FEATURE_LEANBACK, true)
        app.getSharedPreferences("blofy_catalog_sync_state", 0).edit().clear().commit()
        app.getSharedPreferences("blofy_portal_reconciliation_v1", 0).edit().clear().commit()
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        previousDatabase = singleton.get(null)
        singleton.set(null, db)
        runBlocking(Dispatchers.IO) {
            db.dao().saveAndActivateProvider(first)
            db.dao().upsertProvider(second)
            for (provider in listOf(first, second)) {
                db.dao().upsertStreams(listOf(StreamEntity("${provider.id}:live:1", provider.id, "1", "news", "live", "Channel")))
                CatalogSyncState.markCatalogCommitted(app, provider.id)
            }
        }
        controller = Robolectric.buildActivity(ProviderManagerActivity::class.java)
        activity.activationEndpoint = "" // All selection checks remain local.
        checkNotNull(controller).setup().visible()
    }

    @After fun cleanup() {
        controller?.pause()?.stop()?.destroy()
        shadowOf(Looper.getMainLooper()).idle()
        singleton.set(null, previousDatabase)
        db.close()
    }

    private fun connect(provider: ProviderEntity) {
        ProviderManagerActivity::class.java.getDeclaredMethod("connect", ProviderEntity::class.java)
            .apply { isAccessible = true }.invoke(activity, provider)
    }

    private fun awaitSelection() {
        val changing = ProviderManagerActivity::class.java.getDeclaredField("changingProvider").apply { isAccessible = true }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (!changing.getBoolean(activity)) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        fail("Provider selection did not complete")
    }

    private fun activeIds() = runBlocking(Dispatchers.IO) { db.dao().providers().first().map { it.id } }

    @Test fun rapidConnectRequestsOpenOnlyTheFirstChosenProvider() {
        connect(second)
        connect(first)
        awaitSelection()
        assertEquals(listOf(second.id), activeIds())
        assertEquals(HomeActivity::class.java.name, shadowOf(activity).nextStartedActivity?.component?.className)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun pendingReplacementStillOpensTheKnownGoodChosenCatalog() {
        PortalSyncBook.markPendingSource(app, second.id)
        connect(second)
        awaitSelection()
        assertEquals(listOf(second.id), activeIds())
        assertEquals(HomeActivity::class.java.name, shadowOf(activity).nextStartedActivity?.component?.className)
        assertTrue(PortalSyncBook.hasPendingSource(app, second.id))
    }

    @Test fun deletedSelectionKeepsTheActivePlaylistAndDoesNotNavigate() {
        connect(second.copy(id = "no-longer-saved"))
        awaitSelection()
        assertEquals(listOf(first.id), activeIds())
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun firstWebsiteRefreshRegistersTheDeviceBeforeReadingItsPlaylists() {
        runBlocking(Dispatchers.IO) { db.clearAllTables() }
        var registered = false
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                    "/api/v1/activation/check" -> {
                        registered = true
                        MockResponse().setBody("""{"status":"trial","expiresAt":4102444800000}""")
                    }
                    "/api/v1/portal/playlists/list" -> if (registered) MockResponse().setBody("""{"items":[]}""")
                        else MockResponse().setResponseCode(403).setBody("""{"error":"unauthorized_device"}""")
                    else -> MockResponse().setResponseCode(404)
                }.setHeader("Content-Type", "application/json")
            }
            server.start()
            activity.activationEndpoint = server.url("/").toString()
            val refresh = ProviderManagerActivity::class.java.getDeclaredField("websiteRefreshButton")
                .apply { isAccessible = true }.get(activity) as Button
            assertTrue(refresh.performClick())
            val refreshing = ProviderManagerActivity::class.java.getDeclaredField("refreshingFromWebsite").apply { isAccessible = true }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (refreshing.getBoolean(activity) && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertFalse("Initial refresh must complete", refreshing.getBoolean(activity))
            assertTrue(refresh.isEnabled)
            assertEquals(2, server.requestCount)
            assertEquals("/api/v1/activation/check", server.takeRequest().path)
            assertEquals("/api/v1/portal/playlists/list", server.takeRequest().path)
            assertTrue(runBlocking(Dispatchers.IO) { checkNotNull(db.dao().activation()).activated })
            assertNull(shadowOf(activity).nextStartedActivity)
        }
    }
}
