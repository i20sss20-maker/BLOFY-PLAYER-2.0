package tv.blofy.player.core.identity

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.core.cloud.ProfileCloudClient

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ActivationRedirectSecurityTest {
    @Test fun activationRejectsRedirectsInsteadOfTreatingAnotherEndpointAsTheService() = runBlocking {
        MockWebServer().use { service -> MockWebServer().use { other ->
            service.start(); other.start()
            for (status in listOf(301, 302, 307, 308)) {
                service.enqueue(MockResponse().setResponseCode(status).setHeader("Location", other.url("/stolen")))
                other.enqueue(MockResponse().setBody("{\"status\":\"active\",\"serverTime\":1}"))
                val result = runCatching {
                    ActivationRemoteClient.create(service.url("/").toString())
                        .check(ActivationCheckRequest("BLOFY-TEST-ONLY", "123456", "test"))
                }
                assertTrue(result.isFailure)
            }
            assertEquals(4, service.requestCount)
            assertEquals(0, other.requestCount)
        } }
    }

    @Test fun profileHeadersNeverReachARedirectDestination() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        MockWebServer().use { service -> MockWebServer().use { other ->
            service.start(); other.start()
            service.enqueue(MockResponse().setResponseCode(302).setHeader("Location", other.url("/capture")))
            other.enqueue(MockResponse().setBody("{\"exists\":false,\"revision\":0}"))
            assertTrue(runCatching { ProfileCloudClient.get(app, service.url("/").toString(), "default") }.isFailure)
            val sent = service.takeRequest()
            assertNotNull(sent.getHeader("X-BLOFY-Device-ID"))
            assertNotNull(sent.getHeader("X-BLOFY-Activation-Code"))
            assertEquals(0, other.requestCount)
        } }
    }
}
