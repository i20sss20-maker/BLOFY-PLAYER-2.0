package tv.blofy.player.ui.login

import android.app.Application
import android.content.pm.PackageManager
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
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
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.core.identity.PortalSyncBook
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.home.HomeActivity
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.Key
import java.security.KeyStoreSpi
import java.security.Provider
import java.security.Security
import java.security.cert.Certificate
import java.util.Collections
import java.util.Date
import java.util.concurrent.atomic.AtomicInteger

/** Requests go only to MockWebServer. No production service or user credentials are used. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w1280dp-h720dp-land")
@LooperMode(LooperMode.Mode.PAUSED)
class LoginLocalEntryRegressionTest {
    private lateinit var db: BlofyDatabase
    private lateinit var server: MockWebServer
    private var controller: ActivityController<LoginActivity>? = null
    private val app get() = RuntimeEnvironment.getApplication()
    private val activity get() = checkNotNull(controller).get()
    private val provider = ProviderEntity("saved-a", "Saved A", "https://example.test", "viewer", "secret")
    private val singletonField = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previousDatabase: Any? = null

    @Before fun setup() {
        shadowOf(app.packageManager).setSystemFeature(PackageManager.FEATURE_LEANBACK, true)
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        previousDatabase = singletonField.get(null)
        singletonField.set(null, db)
        server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(503).setBody("unavailable")
            }
            start()
        }
        runBlocking(Dispatchers.IO) {
            val dao = db.dao()
            dao.saveAndActivateProvider(provider)
            dao.upsertStreams(listOf(StreamEntity("saved-a:live:1", provider.id, "1", "news", "live", "Channel")))
            CatalogSyncState.markCatalogCommitted(app, provider.id)
            val identity = ActivationManager(app, dao).ensureIdentity()
            dao.upsertActivation(identity.copy(activated = true, expiresAt = System.currentTimeMillis() + TimeUnit.DAYS.toMillis(1)))
        }
    }

    @After fun cleanup() {
        controller?.pause()?.stop()?.destroy()
        shadowOf(Looper.getMainLooper()).idle()
        singletonField.set(null, previousDatabase)
        server.shutdown()
        db.close()
    }

    private fun launch() {
        controller = Robolectric.buildActivity(LoginActivity::class.java)
        // Override before onCreate/onResume so an accidental request is observed locally too.
        activity.activationEndpoint = server.url("/").toString()
        checkNotNull(controller).setup().visible()
        awaitJob("identityJob")
        assertEquals(1, field<LinearLayout>("playlistRow").childCount)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(name: String): T = LoginActivity::class.java.getDeclaredField(name)
        .apply { isAccessible = true }.get(activity) as T

    private fun awaitJob(name: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (field<Job?>(name)?.isActive != true) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        fail("Login job did not complete: $name")
    }

    private fun connect() {
        assertTrue(field<Button>("connectButton").performClick())
        awaitJob("connectJob")
    }

    private fun assertHomeOpened() {
        val intent = shadowOf(activity).nextStartedActivity
        assertNotNull("Expected local Home entry", intent)
        assertEquals(HomeActivity::class.java.name, intent.component?.className)
    }

    @Test fun creationAndRepeatedResumeNeverFetchThePortalOrRecreateIdenticalCards() {
        launch()
        val row = field<LinearLayout>("playlistRow")
        val originalCard = row.getChildAt(0)
        repeat(4) {
            checkNotNull(controller).pause().resume()
            awaitJob("identityJob")
            assertSame(originalCard, row.getChildAt(0))
        }
        assertEquals(0, server.requestCount)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun identityAndSavedCardsDoNotWaitForProviderKeystoreAccess() {
        val stored = provider.copy(baseUrl = "BLOFYENC1:stored-host", username = "BLOFYENC1:stored-user",
            password = "BLOFYENC1:stored-password", subscriberToken = "BLOFYENC1:stored-token")
        val identity = runBlocking(Dispatchers.IO) {
            db.dao().upsertProviderStored(stored)
            checkNotNull(db.dao().activation())
        }
        LoginKeystoreSpi.loads.set(0)
        val recording = object : Provider("BlofyLoginRegression", 1.0, "Records unwanted login key access") {
            init { put("KeyStore.AndroidKeyStore", LoginKeystoreSpi::class.java.name) }
        }
        Security.insertProviderAt(recording, 1)
        try {
            launch()
            assertEquals(identity.deviceId, field<TextView>("deviceView").text.toString())
            assertEquals(identity.activationCode, field<TextView>("codeView").text.toString())
            assertNotNull(field<LinearLayout>("playlistRow").findViewWithTag<View>(provider.id))
            assertEquals("Drawing saved identities must not contact a TV's Keystore", 0, LoginKeystoreSpi.loads.get())
            assertEquals(stored, runBlocking(Dispatchers.IO) { db.dao().providerStored(provider.id) })
            assertEquals(0, server.requestCount)
        } finally {
            Security.removeProvider(recording.name)
        }
    }

    @Test fun connectOpensCommittedLibraryWithoutAnyNetworkRequest() {
        launch()
        connect()
        assertHomeOpened()
        assertEquals(0, server.requestCount)
    }

    @Test fun pendingWebsiteReplacementDoesNotBlockTheKnownGoodLibrary() {
        PortalSyncBook.markPendingSource(app, provider.id)
        assertFalse(CatalogSyncState.isFullyReady(app, provider.id))
        launch()
        connect()
        assertHomeOpened()
        assertEquals(0, server.requestCount)
    }

    @Test fun expiredActivationCannotEnterHomeWhenTheServerIsUnavailable() {
        runBlocking(Dispatchers.IO) {
            val identity = checkNotNull(db.dao().activation())
            db.dao().upsertActivation(identity.copy(expiresAt = 1L))
        }
        launch()
        connect()
        assertNull(shadowOf(activity).nextStartedActivity)
        assertEquals(1, server.requestCount)
        assertTrue(field<Button>("connectButton").isEnabled)
    }

    @Test fun websiteRefreshIsStillPresentAndFailureDoesNotEraseLocalCards() {
        launch()
        val row = field<LinearLayout>("playlistRow")
        val card = row.getChildAt(0)
        val root = activity.findViewById<FrameLayout>(android.R.id.content)
        val refresh = root.findViewWithTag<Button>("blofy_login_portal_refresh")
        assertNotNull("Removing a lifecycle must not remove its feature", refresh)
        refresh.performClick()
        refresh.performClick()
        awaitJob("identityJob")
        assertSame(card, row.getChildAt(0))
        assertTrue(refresh.isEnabled)
        assertEquals(1, server.requestCount)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun uncommittedRowsCannotMasqueradeAsAReadySavedLibrary() {
        runBlocking(Dispatchers.IO) { CatalogSyncState.clear(app, provider.id) }
        launch()
        // A blank build endpoint is supported for local development, but cannot bypass catalog readiness.
        activity.activationEndpoint = ""
        field<LinearLayout>("playlistRow").getChildAt(0).performClick()
        awaitJob("playlistJob")
        val intent = shadowOf(activity).nextStartedActivity
        assertNotNull(intent)
        assertEquals(CatalogLoadingActivity::class.java.name, intent.component?.className)
        assertEquals(provider.id, intent.getStringExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID))
        assertFalse(CatalogSyncState.isEntryReady(app, provider.id))
    }

    @Test fun savedCardUsesItsIdAndActivatesTheChosenProviderBeforeHome() {
        launch()
        val chosen = provider.copy(id = "saved-b", name = "Saved B", enabled = false)
        runBlocking(Dispatchers.IO) {
            db.dao().upsertProvider(chosen)
            db.dao().upsertStreams(listOf(StreamEntity("saved-b:live:1", chosen.id, "1", "news", "live", "B channel")))
            CatalogSyncState.markCatalogCommitted(app, chosen.id)
        }
        checkNotNull(controller).pause().resume()
        awaitJob("identityJob")
        activity.activationEndpoint = ""
        val card = field<LinearLayout>("playlistRow").findViewWithTag<View>(chosen.id)
        assertNotNull(card)
        card.performClick()
        awaitJob("playlistJob")
        assertHomeOpened()
        runBlocking(Dispatchers.IO) {
            assertTrue(checkNotNull(db.dao().provider(chosen.id)).enabled)
            assertFalse(checkNotNull(db.dao().provider(provider.id)).enabled)
        }
    }

    private fun requestProfileWhile(update: suspend () -> Unit) = runBlocking(Dispatchers.IO) {
        val requested = CountDownLatch(1)
        val release = CountDownLatch(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path != "/api/v1/provider-profile") return MockResponse().setResponseCode(404)
                requested.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                return MockResponse().setHeader("Content-Type", "application/json")
                    .setBody("""{"liveFormat":"m3u8","preferredTransport":"http"}""")
            }
        }
        val request = async { activity.applyRemoteProviderProfile(server.url("/").toString(), db.dao(), provider.id) }
        try {
            assertTrue("Profile request did not start", requested.await(5, TimeUnit.SECONDS))
            update()
        } finally {
            release.countDown()
        }
        request.await()
    }

    @Test fun delayedProfileCannotOverwriteACommittedSourceReplacement() {
        launch()
        val replacement = provider.copy(baseUrl = "https://replacement.test", username = "new-user", password = "new-password")
        requestProfileWhile { db.dao().upsertProvider(replacement) }
        runBlocking(Dispatchers.IO) { assertEquals(replacement, db.dao().provider(provider.id)) }
        assertEquals(1, server.requestCount)
    }

    @Test fun delayedProfileCannotApplyToAReboundRemoteIdentity() {
        PortalSyncBook.bind(app, provider.id, "original-remote")
        launch()
        requestProfileWhile { PortalSyncBook.bind(app, provider.id, "replacement-remote") }
        runBlocking(Dispatchers.IO) { assertEquals(provider, db.dao().provider(provider.id)) }
        assertEquals(1, server.requestCount)
    }

    @Test fun profileMergesIntoLatestNameAndSelectionWithoutRestoringOldSnapshot() {
        launch()
        val latest = provider.copy(name = "Renamed while waiting", enabled = false, updatedAt = 123L)
        requestProfileWhile { db.dao().upsertProvider(latest) }
        runBlocking(Dispatchers.IO) {
            assertEquals(latest.copy(liveFormat = "m3u8", preferredTransport = "http"), db.dao().provider(provider.id))
        }
        assertEquals(1, server.requestCount)
    }
}

/** Failing keys are enough to expose an unnecessary read, without hanging a test worker. */
class LoginKeystoreSpi : KeyStoreSpi() {
    companion object { val loads = AtomicInteger() }
    override fun engineLoad(stream: InputStream?, password: CharArray?) {
        loads.incrementAndGet()
        throw IOException("Simulated unavailable TV Keystore")
    }
    override fun engineGetKey(alias: String?, password: CharArray?): Key? = null
    override fun engineGetCertificateChain(alias: String?): Array<Certificate>? = null
    override fun engineGetCertificate(alias: String?): Certificate? = null
    override fun engineGetCreationDate(alias: String?): Date? = null
    override fun engineSetKeyEntry(alias: String?, key: Key?, password: CharArray?, chain: Array<out Certificate>?) = Unit
    override fun engineSetKeyEntry(alias: String?, key: ByteArray?, chain: Array<out Certificate>?) = Unit
    override fun engineSetCertificateEntry(alias: String?, cert: Certificate?) = Unit
    override fun engineDeleteEntry(alias: String?) = Unit
    override fun engineAliases() = Collections.emptyEnumeration<String>()
    override fun engineContainsAlias(alias: String?) = false
    override fun engineSize() = 0
    override fun engineIsKeyEntry(alias: String?) = false
    override fun engineIsCertificateEntry(alias: String?) = false
    override fun engineGetCertificateAlias(cert: Certificate?): String? = null
    override fun engineStore(stream: OutputStream?, password: CharArray?) = Unit
}
