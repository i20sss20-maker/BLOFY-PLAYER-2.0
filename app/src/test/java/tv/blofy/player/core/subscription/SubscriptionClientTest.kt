package tv.blofy.player.core.subscription

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.core.identity.DeviceIdentity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28, 35], application = Application::class)
class SubscriptionClientTest {
    private lateinit var server: MockWebServer
    private val app get() = RuntimeEnvironment.getApplication()

    @Before fun setup() { server = MockWebServer().also { it.start() } }
    @After fun cleanup() { server.shutdown() }

    @Test fun subscriptionStatusUsesPostBodyAndNeverLeaksActivationCodeInUrl() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setResponseCode(200).setHeader("content-type", "application/json").setBody("""{"active":false}"""))
        SubscriptionClient.status(app, server.url("/").toString())
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/subscriptions/status", request.requestUrl?.encodedPath)
        assertNull(request.requestUrl?.query)
        val body = JSONObject(request.body.readUtf8())
        assertEquals(DeviceIdentity.deviceId(app), body.getString("deviceId"))
        assertEquals(DeviceIdentity.activationCode(app), body.getString("activationCode"))
    }
}
