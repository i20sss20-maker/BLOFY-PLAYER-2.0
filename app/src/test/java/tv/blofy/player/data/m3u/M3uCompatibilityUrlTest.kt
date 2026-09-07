package tv.blofy.player.data.m3u

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class M3uCompatibilityUrlTest {
    private val loader = M3uPlaylistLoader()

    @Test
    fun arbitrary_m3u_url_is_never_rewritten() {
        val url = "https://cdn.example.com/list/channel-list.m3u?token=abc"
        assertEquals(listOf(url), loader.compatiblePlaylistUrls(url))
    }

    @Test
    fun xtream_get_php_gets_bounded_output_variants() {
        val url = "https://panel.example.com/get.php?username=user&password=pass"
        val urls = loader.compatiblePlaylistUrls(url)
        assertEquals(3, urls.size)
        assertEquals(url, urls.first())
        assertTrue(urls.any { it.contains("type=m3u_plus") && it.contains("output=ts") })
        assertTrue(urls.any { it.contains("type=m3u_plus") && it.contains("output=m3u8") })
    }

    @Test
    fun get_php_without_credentials_is_not_modified() {
        val url = "https://panel.example.com/get.php?token=abc"
        assertEquals(listOf(url), loader.compatiblePlaylistUrls(url))
    }
}
