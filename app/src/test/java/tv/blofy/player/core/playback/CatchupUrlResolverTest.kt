package tv.blofy.player.core.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CatchupUrlResolverTest {
    private val provider = ProviderEntity("provider", "Fixture", "https://fixture.example.test/panel/", "user", "pass")
    private val stream = StreamEntity("provider:live:42", provider.id, "42", null, "live", "Archive", archiveEnabled = true)
    private val startMs = 1_700_000_000_000L

    @Test fun reservedCharactersAndUnicodeRemainSingleCredentialSegments() {
        val credentials = provider.copy(username = " user/+?#% صالح ", password = "p/ass?x=1#part%+ كلمة")
        val url = CatchupUrlResolver.xtream(credentials, stream, startMs, startMs + 120_000L)
        val uri = URI(url)
        val segments = uri.rawPath.split('/').filter(String::isNotEmpty)

        assertEquals(7, segments.size)
        assertEquals("panel", segments[0])
        assertEquals("timeshift", segments[1])
        assertEquals(credentials.username, decode(segments[2]))
        assertEquals(credentials.password, decode(segments[3]))
        assertEquals("2", segments[4])
        assertEquals("42.ts", segments[6])
        assertNull(uri.rawQuery)
        assertNull(uri.rawFragment)
        assertFalse(url.contains(' '))
    }

    @Test fun literalPercentAndPlusAreNotTreatedAsExistingEscapesOrSpaces() {
        val url = CatchupUrlResolver.xtream(provider.copy(username = "%2F", password = "a+b c"),
            stream, startMs, startMs + 60_000L)
        val segments = URI(url).rawPath.split('/').filter(String::isNotEmpty)
        assertEquals("%252F", segments[2])
        assertEquals("a%2Bb%20c", segments[3])
        assertEquals("%2F", decode(segments[2]))
        assertEquals("a+b c", decode(segments[3]))
    }

    @Test fun ordinaryCredentialsKeepTheExistingCatchupEndpointAndTiming() {
        val start = SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).format(Date(startMs))
        assertEquals("https://fixture.example.test/panel/timeshift/user/pass/2/$start/42.ts",
            CatchupUrlResolver.xtream(provider, stream, startMs, startMs + 120_000L))
    }

    private fun decode(value: String): String = URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}
