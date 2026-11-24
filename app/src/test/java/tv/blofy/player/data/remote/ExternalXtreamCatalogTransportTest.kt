package tv.blofy.player.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.core.identity.ExternalStreamConnectClient

class ExternalXtreamCatalogTransportTest {
    private val transport = ExternalXtreamCatalogTransport
    private val credentials = ExternalStreamConnectClient.Credentials(
        "https://provider.example.com:8443".toHttpUrl(), "a/b", "p?ss#word"
    )
    private fun opaque(query: String) = (transport.ORIGIN + "/player_api.php?" + query).toHttpUrl()

    @Test fun nativeCatalogActionsUseProviderOriginAndEncodedCredentials() {
        for (query in listOf(
            "action=get_live_categories", "action=get_vod_categories", "action=get_series_categories",
            "action=get_live_streams&category_id=1", "action=get_vod_streams",
            "action=get_series", "action=get_series_info&series_id=123",
            "action=get_vod_info&vod_id=5", "action=get_short_epg&stream_id=8&limit=20",
            "action=get_simple_data_table&stream_id=8"
        )) {
            val input = opaque(query)
            val resolved = transport.resolve(input, credentials)
            assertEquals("provider.example.com", resolved.host)
            assertEquals(8443, resolved.port)
            assertEquals("/player_api.php", resolved.encodedPath)
            assertEquals("a/b", resolved.queryParameter("username"))
            assertEquals("p?ss#word", resolved.queryParameter("password"))
            for (field in input.queryParameterNames)
                assertEquals(input.queryParameter(field), resolved.queryParameter(field))
            assertFalse(input.toString().contains("password"))
        }
    }

    @Test fun denyUnknownActionsDuplicateParametersAndUntrustedRoutes() {
        for (query in listOf(
            "action=get_live_streams&username=attacker", "action=get_live_streams&action=get_series",
            "action=get_series_info", "action=get_series_info&series_id=..%2F123",
            "action=get_live_streams&category_id=1&category_id=2", "action=delete",
            "action=get_short_epg&stream_id=5&limit=1001"
        )) assertThrows(IllegalArgumentException::class.java) { transport.resolve(opaque(query), credentials) }
        for (url in listOf(
            "https://blofyplayer.com/player_api.php?action=get_live_streams",
            "https://external-xtream.invalid:444/player_api.php?action=get_live_streams",
            "https://external-xtream.invalid/movie?action=get_live_streams"
        )) assertThrows(IllegalArgumentException::class.java) { transport.resolve(url.toHttpUrl(), credentials) }
        val client = transport.client(credentials)
        assertFalse(client.followRedirects)
        assertFalse(client.followSslRedirects)
    }
}
