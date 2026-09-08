package tv.blofy.player.core.identity

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.ProviderEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class BlofySubscriberDirectTest {
    private val endpoint = "https://app.example.test"
    private fun payload(host: String = "https://origin.example.test:8443/provider") = JSONObject().apply {
        put("delivery", "direct"); put("baseUrl", host); put("username", "مستخدم +/&")
        put("password", " p&/+🔒 "); put("sessionToken", "opaque_session-token")
    }

    @Test fun directConfigurationPreservesCredentialsAndHostPath() {
        val session = BlofySubscriberClient.parseDirectSession(payload())
        assertEquals("https://origin.example.test:8443/provider", session.baseUrl)
        assertEquals("مستخدم +/&", session.username)
        assertEquals(" p&/+🔒 ", session.password)
        assertEquals("opaque_session-token", session.sessionToken)
    }

    @Test fun managedPortalSaveKeepsTheOpaqueDescriptorAndStableProviderId() {
        val provider = ProviderEntity("same-id", "Custom name", "https://origin.example.test", "real-user", "real-pass", subscriberToken = "opaque-token")
        val saved = BlofySubscriberClient.portalSource(provider, endpoint)
        assertEquals("same-id", saved.id)
        assertEquals("$endpoint/api/v1/subscribers/xtream", saved.baseUrl)
        assertEquals("opaque-token", saved.username)
        assertEquals("blofy", saved.password)
        assertTrue(BlofySubscriberClient.isManaged(provider))
        val ordinary = provider.copy(subscriberToken = "")
        assertEquals(ordinary, BlofySubscriberClient.portalSource(ordinary, endpoint))
        assertFalse(BlofySubscriberClient.isManaged(ordinary))
    }

    @Test fun onlyTheConfiguredGatewayCanSupplyALegacySessionToResolve() {
        val provider = ProviderEntity("p", "p", "$endpoint/api/v1/subscribers/xtream", "token", "blofy")
        assertTrue(BlofySubscriberClient.isLegacyProxy(provider, endpoint))
        for (host in listOf("https://evil.example.test", "$endpoint.evil.test", "http://app.example.test", "$endpoint:444")) {
            assertFalse(BlofySubscriberClient.isLegacyProxy(provider.copy(baseUrl = "$host/api/v1/subscribers/xtream"), endpoint))
        }
        assertFalse(BlofySubscriberClient.isLegacyProxy(provider.copy(baseUrl = provider.baseUrl + "?redirect=1"), endpoint))
        assertFalse(BlofySubscriberClient.isLegacyProxy(provider.copy(subscriberToken = "already-direct"), endpoint))
    }

    @Test fun invalidDirectResponsesAndLegacyResponsesCannotSilentlyRestoreProxyPlayback() {
        for (host in listOf("file:///private", "http://127.0.0.1", "https://user:password@origin.example.test", "$endpoint/api/v1/subscribers/xtream", "https://origin.example.test?password=bad")) {
            assertThrows(IllegalStateException::class.java) { BlofySubscriberClient.parseDirectSession(payload(host)) }
        }
        assertThrows(IllegalStateException::class.java) { BlofySubscriberClient.parseDirectSession(payload().put("delivery", "proxy")) }
        assertThrows(IllegalStateException::class.java) { BlofySubscriberClient.parseDirectSession(payload().put("sessionToken", "")) }
        assertThrows(IllegalArgumentException::class.java) { BlofySubscriberClient.serviceEndpoint("http://app.example.test") }
        assertThrows(IllegalArgumentException::class.java) { BlofySubscriberClient.serviceEndpoint("https://user:password@app.example.test") }
    }

    @Test fun sourceChangesRemainVisibleForManagedAccounts() {
        val first = ProviderEntity("id", "Saved", "https://origin.example.test", "u", "p", subscriberToken = "one")
        assertTrue(PortalPlaylistClient.sameSource(first, first.copy(subscriberToken = "renewed")))
        assertFalse(PortalPlaylistClient.sameSource(first, first.copy(username = "other-account")))
        assertFalse(PortalPlaylistClient.sameSource(first, first.copy(baseUrl = "https://next.example.test")))
    }
}
