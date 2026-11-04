package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.ProviderEntity

class ManagedCatalogTransportTest {
    private val gateway = "https://api.blofyplayer.com"

    @Test fun blofyManagedAccountUsesSecureGatewayFirstAndDirectOriginSecond() {
        val direct = ProviderEntity(
            id = "saved-provider", name = "مشتركين BLOFY",
            baseUrl = "http://annkel.com:80", username = "real-user",
            password = "real-password", subscriberToken = "opaque-test-token"
        )
        val candidates = ManagedCatalogTransport.candidates(direct, gateway)
        assertEquals(2, candidates.size)
        val proxy = candidates.first()
        assertEquals("saved-provider", proxy.id)
        assertEquals("$gateway/api/v1/subscribers/xtream", proxy.baseUrl)
        assertEquals("opaque-test-token", proxy.username)
        assertEquals("blofy", proxy.password)
        assertEquals(direct, candidates.last())
        assertTrue(proxy.subscriberToken.isNotBlank())
        assertFalse(proxy.baseUrl.contains("annkel.com"))
    }

    @Test fun ordinaryXtreamProviderNeverUsesBlofyGateway() {
        val source = ProviderEntity(
            "id", "My private list", "http://example.test:8080", "u", "p"
        )
        assertEquals(listOf(source), ManagedCatalogTransport.candidates(source, gateway))
    }

    @Test fun candidateCreationDoesNotMutateSavedDirectPlaybackHost() {
        val direct = ProviderEntity(
            "stable", "BLOFY", "http://example.test:80",
            "name", "pass", subscriberToken = "token"
        )
        ManagedCatalogTransport.candidates(direct, gateway)
        assertEquals("http://example.test:80", direct.baseUrl)
        assertEquals("name", direct.username)
    }
}
