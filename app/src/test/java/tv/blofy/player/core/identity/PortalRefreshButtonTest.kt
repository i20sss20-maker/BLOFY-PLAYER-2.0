package tv.blofy.player.core.identity

import android.app.Application
import android.os.Looper
import android.widget.Button
import android.widget.TextView
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
import tv.blofy.player.R
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.playlist.ProviderManagerActivity
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w1280dp-h720dp-land")
@LooperMode(LooperMode.Mode.PAUSED)
class PortalRefreshButtonTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private lateinit var server: MockWebServer
    private var controller: ActivityController<*>? = null
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previous: Any? = null
    private var partial = false
    private val reads = AtomicInteger()

    @Before fun setup() {
        app.getSharedPreferences("blofy_catalog_sync_state", 0).edit().clear().commit()
        app.getSharedPreferences("blofy_portal_reconciliation_v1", 0).edit().clear().commit()
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        previous = singleton.get(null); singleton.set(null, db)
        runBlocking(Dispatchers.IO) {
            val dao = db.dao()
            dao.saveAndActivateProvider(ProviderEntity("saved", "Saved", "https://provider.example", "u", "p"))
            dao.upsertStreams(listOf(StreamEntity("saved:live:1", "saved", "1", "news", "live", "Channel")))
            val identity = ActivationManager(app, dao).ensureIdentity()
            dao.upsertActivation(identity.copy(activated = true, expiresAt = 4102444800000L))
            PortalSyncBook.bind(app, "saved", "saved")
        }
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/v1/activation/check" -> MockResponse().setBody("""{"status":"active","expiresAt":4102444800000} """)
                "/api/v1/portal/playlists/list" -> {
                    val count = reads.incrementAndGet()
                    if (!partial && count == 1) MockResponse().setResponseCode(503)
                    else {
                        val bad = if (partial) ",{\"id\":\"broken\",\"providerType\":\"xtream\",\"baseUrl\":\"https://provider.example\",\"username\":\"u\",\"password\":\"\"}" else ""
                        MockResponse().setBody("""{"items":[{"id":"saved","name":"Saved","providerType":"xtream","baseUrl":"https://provider.example","username":"u","password":"p","active":false},{"id":"new-site","name":"قائمة عربية","providerType":"xtream","baseUrl":"https://provider.example","username":"new","password":"secret","active":true}$bad]}""")
                    }
                }
                else -> MockResponse().setResponseCode(404)
            }.setHeader("Content-Type", "application/json")
        }
        server.start()
    }
    @After fun cleanup() {
        controller?.pause()?.stop()?.destroy(); shadowOf(Looper.getMainLooper()).idle()
        server.shutdown(); singleton.set(null, previous); db.close()
    }
    private fun await(done: () -> Boolean) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (System.nanoTime() < end) { shadowOf(Looper.getMainLooper()).idle(); if (done()) return; Thread.sleep(10) }
        fail("Refresh did not finish")
    }
    private fun field(target: Any, name: String): Any? = target.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(target)
    private fun assertSaved() = runBlocking(Dispatchers.IO) {
        assertEquals("قائمة عربية", db.dao().provider("new-site")?.name)
        assertNotNull(db.dao().provider("saved"))
        assertTrue(db.dao().hasStreamsForProvider("saved"))
        assertEquals(4102444800000L, db.dao().activation()?.expiresAt)
    }
    @Test fun managerButtonRetriesTransientReadAndIgnoresDoubleClickWithoutNavigation() {
        val c = Robolectric.buildActivity(ProviderManagerActivity::class.java); controller = c
        val activity = c.get(); activity.activationEndpoint = server.url("/").toString(); c.setup().visible()
        val button = field(activity, "websiteRefreshButton") as Button
        assertTrue(button.performClick()); button.performClick()
        await { field(activity, "refreshingFromWebsite") == false }
        assertTrue(button.isEnabled); assertEquals(2, reads.get()); assertSaved()
        assertNull(shadowOf(activity).nextStartedActivity)
        assertEquals(activity.getString(R.string.portal_refresh_complete, 2), (field(activity, "status") as TextView).text.toString())
    }
    @Test fun loginButtonImportsValidListsReportsPartialAndPreservesSavedContent() {
        partial = true
        val c = Robolectric.buildActivity(LoginActivity::class.java); controller = c
        val activity = c.get(); activity.activationEndpoint = server.url("/").toString(); c.setup().visible()
        await { (field(activity, "identityJob") as? Job)?.isActive != true }
        val button = field(activity, "websiteRefreshButton") as Button
        assertTrue(button.performClick()); button.performClick()
        await { (field(activity, "identityJob") as? Job)?.isActive != true }
        assertTrue(button.isEnabled); assertEquals(1, reads.get()); assertSaved()
        assertNull(shadowOf(activity).nextStartedActivity)
        assertEquals(activity.getString(R.string.portal_refresh_partial, 2, 1), (field(activity, "status") as TextView).text.toString())
    }
}
