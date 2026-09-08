package tv.blofy.player.ui.login

import android.app.Application
import android.content.Intent
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
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
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "w1280dp-h720dp-land-television")
@LooperMode(LooperMode.Mode.PAUSED)
class LoginSavedEntryRegressionTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val dao get() = BlofyDatabase.get(app).dao()
    private lateinit var server: MockWebServer
    private lateinit var provider: ProviderEntity
    private var controller: ActivityController<LoginActivity>? = null
    private val release = CountDownLatch(1)
    private val requests = CopyOnWriteArrayList<String>()

    @Before fun setup() = runBlocking(Dispatchers.IO) {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request.path.orEmpty())
                check(release.await(10, TimeUnit.SECONDS))
                return MockResponse().setResponseCode(503).setBody("{}")
            }
        }
        server.start()
        provider = ProviderEntity(UUID.randomUUID().toString(), "Saved test library", "https://example.invalid", "u", "p")
        dao.saveAndActivateProvider(provider)
        dao.replaceCatalog(provider.id, "movie", emptyList(), listOf(
            StreamEntity("${provider.id}:movie:1", provider.id, "1", null, "movie", "Saved movie")
        ))
        CatalogSyncState.markCatalogCommitted(app, provider.id)
        val manager = ActivationManager(app, dao)
        manager.ensureIdentity()
        manager.applyRemoteStatus(true, System.currentTimeMillis() + 60_000L)
    }

    @After fun cleanup() {
        release.countDown()
        controller?.pause()?.stop()?.destroy()
        runBlocking(Dispatchers.IO) {
            PortalSyncBook.clearPendingSource(app, provider.id)
            dao.clearProviderCatalog(provider.id)
            dao.deleteProvider(provider.id)
            CatalogSyncState.clear(app, provider.id)
        }
        server.shutdown()
    }

    private fun openLogin(): LoginActivity {
        val activityController = Robolectric.buildActivity(LoginActivity::class.java)
        activityController.get().activationEndpoint = server.url("/").toString()
        controller = activityController
        activityController.setup()
        val activity = activityController.get()
        waitUntil { views(activity.window.decorView).filterIsInstance<TextView>().any { it.text.toString() == provider.name } }
        return activity
    }

    private fun waitUntil(check: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        fail("Expected local UI state did not appear before the stalled network was released")
    }

    private fun views(root: View): List<View> = listOf(root) + if (root is ViewGroup)
        (0 until root.childCount).flatMap { views(root.getChildAt(it)) } else emptyList()

    private fun connect(activity: LoginActivity): Intent {
        val field = LoginActivity::class.java.getDeclaredField("connectButton").apply { isAccessible = true }
        (field.get(activity) as Button).performClick()
        var next: Intent? = null
        waitUntil { next = shadowOf(activity).nextStartedActivity; next != null }
        return checkNotNull(next)
    }

    @Test fun openingAndResumingLoginDisplaysSavedCardsWithoutPortalHttp() {
        val activity = openLogin()
        val originalCard = views(activity.window.decorView).filterIsInstance<TextView>().single { it.text.toString() == provider.name }
        controller!!.pause().resume()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(requests.isEmpty())
        assertSame(originalCard, views(activity.window.decorView).filterIsInstance<TextView>().single { it.text.toString() == provider.name })
    }

    @Test fun connectOpensHomeWhileWebsiteResponsesRemainBlocked() {
        val activity = openLogin()
        val next = connect(activity)
        assertEquals(HomeActivity::class.java.name, next.component?.className)
        assertEquals(1L, release.count)
        assertFalse(requests.any { it.endsWith("/playlists/list") || it.endsWith("/provider-profile") })
    }

    @Test fun choosingSavedCardOpensHomeWithoutWaitingForWebsite() {
        val activity = openLogin()
        val label = views(activity.window.decorView).filterIsInstance<TextView>()
            .single { it.text.toString() == provider.name }
        var card = label as View
        while (!card.isClickable) card = card.parent as View
        assertTrue(card.performClick())
        var next: Intent? = null
        waitUntil { next = shadowOf(activity).nextStartedActivity; next != null }
        assertEquals(HomeActivity::class.java.name, next?.component?.className)
        assertEquals(1L, release.count)
        assertFalse(requests.any { it.endsWith("/playlists/list") || it.endsWith("/provider-profile") })
    }

    @Test fun explicitActivationRefreshStillChecksServerWithoutRemovingSavedCards() {
        release.countDown()
        val activity = openLogin()
        val mutex = LoginActivity::class.java.getDeclaredField("identityRefreshMutex").apply { isAccessible = true }
            .get(activity) as Mutex
        waitUntil { !mutex.isLocked }
        val originalCard = views(activity.window.decorView).filterIsInstance<TextView>()
            .single { it.text.toString() == provider.name }
        val button = LoginActivity::class.java.getDeclaredField("refreshCodeButton").apply { isAccessible = true }
            .get(activity) as Button
        button.performClick()
        waitUntil { views(activity.window.decorView).filterIsInstance<TextView>()
            .any { it.text.toString().contains("تعذر التحقق من التفعيل") } }
        assertTrue(requests.any { it.endsWith("/activation/check") })
        assertSame(originalCard, views(activity.window.decorView).filterIsInstance<TextView>()
            .single { it.text.toString() == provider.name })
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    @Test fun pendingWebsiteSourceDoesNotSendKnownGoodCatalogBackToLoader() {
        PortalSyncBook.markPendingSource(app, provider.id)
        val next = connect(openLogin())
        assertEquals(HomeActivity::class.java.name, next.component?.className)
        assertEquals(1L, release.count)
    }

    @Test fun expiredCachedActivationCannotEnterHomeWithoutSuccessfulVerification() {
        runBlocking(Dispatchers.IO) {
            ActivationManager(app, dao).applyRemoteStatus(true, System.currentTimeMillis() - 1L)
        }
        release.countDown()
        val activity = openLogin()
        val field = LoginActivity::class.java.getDeclaredField("connectButton").apply { isAccessible = true }
        (field.get(activity) as Button).performClick()
        waitUntil { views(activity.window.decorView).filterIsInstance<TextView>().any { it.text.toString().contains("تعذر التحقق من التفعيل") } }
        assertNull(shadowOf(activity).nextStartedActivity)
        assertTrue(requests.any { it.endsWith("/activation/check") })
    }
}
