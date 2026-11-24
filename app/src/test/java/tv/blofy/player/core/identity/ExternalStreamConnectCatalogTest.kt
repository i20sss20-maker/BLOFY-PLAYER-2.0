package tv.blofy.player.core.identity

import org.junit.Assert.*
import org.junit.Test

class ExternalStreamConnectCatalogTest {
    @Test fun mediaPathsAreBuiltOnlyFromAuthorizedOriginAndEncodedSegments() {
        val host=checkNotNull(ExternalStreamConnectClient.parseHost("https://provider.example.com:8443"))
        val credentials=ExternalStreamConnectClient.Credentials(host,"a/b","p?ss#word")
        val item=ExternalStreamConnectCatalog.Item("123","Demo",ExternalStreamConnectCatalog.Kind.LIVE,"ts")
        val url=ExternalStreamConnectCatalog.mediaUrl(credentials,item)
        assertEquals("https://provider.example.com:8443/live/a%2Fb/p%3Fss%23word/123.ts",url.toString())
        val target=ExternalStreamConnectCatalog.playback(credentials,item)
        assertFalse(target.uri.contains("p%3Fss"))
        assertFalse(target.uri.contains("a%2Fb"))
        assertFalse(target.client.followRedirects)
        assertFalse(target.client.followSslRedirects)
    }
    @Test fun invalidIdsAndFormatsAreRejected() {
        val c=ExternalStreamConnectCatalog
        for(id in listOf("","../123","12?x","123/4","1234567890123456"))assertFalse(c.safeId(id))
        assertNull(c.safeExtension(ExternalStreamConnectCatalog.Kind.MOVIE,"mp4?x"))
        assertNull(c.safeExtension(ExternalStreamConnectCatalog.Kind.MOVIE,"m3u8"))
        assertEquals("ts",c.safeExtension(ExternalStreamConnectCatalog.Kind.LIVE,"m3u8"))
        val host=checkNotNull(ExternalStreamConnectClient.parseHost("https://provider.example.com"))
        val credentials=ExternalStreamConnectClient.Credentials(host,"..","password")
        val item=ExternalStreamConnectCatalog.Item("123","Demo",ExternalStreamConnectCatalog.Kind.MOVIE,"mp4")
        assertThrows(IllegalArgumentException::class.java){c.mediaUrl(credentials,item)}
    }
}
