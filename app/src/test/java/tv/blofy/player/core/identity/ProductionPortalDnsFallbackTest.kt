package tv.blofy.player.core.identity

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class ProductionPortalDnsFallbackTest {
    @Test fun knownActivationServiceCanFailOverOnlyBetweenVerifiedOfficialHttpsHosts() {
        val original = "https://api.blofyplayer.com/api/v1/activation/check".toHttpUrl()
        val targets = ProductionPortalDnsFallback.candidates(original)
        assertEquals(listOf("api.blofyplayer.com", "blofyplayer.com",
            "blofy-activation-portal-production.up.railway.app"), targets.map { it.host })
        assertEquals(listOf("/api/v1/activation/check",
            "/api/v1/activation/check", "/api/v1/activation/check"), targets.map { it.encodedPath })
        assertEquals(listOf("https", "https", "https"), targets.map { it.scheme })
        assertEquals(listOf(443, 443, 443), targets.map { it.port })
    }

    @Test fun unrelatedProvidersNeverReceiveBLOFYCredentials() {
        val foreign = "https://xtream.example.net/api/v1/activation/check".toHttpUrl()
        val http = "http://api.blofyplayer.com/api/v1/activation/check".toHttpUrl()
        val redirected = "https://api.blofyplayer.com.evil.example/api/v1/activation/check".toHttpUrl()
        val nonPortal = "https://api.blofyplayer.com/player_api.php".toHttpUrl()
        val customPort = "https://api.blofyplayer.com:8443/api/v1/activation/check".toHttpUrl()
        for (original in listOf(foreign, http, redirected, nonPortal, customPort)) {
            assertEquals(listOf(original), ProductionPortalDnsFallback.candidates(original))
        }
    }

    @Test fun postPathsAndAnyExistingQueryAreNotRewrittenOrDropped() {
        val src = "https://api.blofyplayer.com/api/v1/portal/playlists/list?keep=exact".toHttpUrl()
        val results = ProductionPortalDnsFallback.candidates(src)
        assertEquals(3, results.size)
        assertEquals(listOf("/api/v1/portal/playlists/list").repeat(3), results.map { it.encodedPath })
        assertEquals(listOf("keep=exact", "keep=exact", "keep=exact"), results.map { it.encodedQuery })
    }
}
