package tv.blofy.player.core.identity

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.EpisodeEntity

class NativeExternalMediaTransportTest {
    private val id = "external-12345678-1234-1234-1234-123456789abc"
    private val other = "external-22345678-1234-1234-1234-123456789abc"
    private val credentials = ExternalStreamConnectClient.Credentials(
        "https://provider.example.com:8443".toHttpUrl(), "private-user", "private-pass")
    private val transport = NativeExternalMediaTransport

    @Test fun routesAreStableOpaqueAndBoundToProvider() {
        for ((kind, ext) in listOf("live" to "ts", "live" to "m3u8", "movie" to "mkv", "series" to "mp4")) {
            val route = transport.route(id, kind, "123", ext)
            assertEquals(route, transport.route(id, kind, "123", ext))
            assertFalse(route.contains("private-"))
            assertFalse(route.contains("provider.example.com"))
            assertEquals("https://provider.example.com:8443/$kind/private-user/private-pass/123.$ext",
                transport.resolveRoot(route.toHttpUrl(), id, credentials).toString())
            assertThrows(IOException::class.java) { transport.resolveRoot(route.toHttpUrl(), other, credentials) }
        }
    }

    @Test fun unknownOriginsAndArbitraryPathsAreDenied() {
        val route = transport.route(id, "live", "123", "ts")
        for (bad in listOf(route + "?x=1", route.replace("https:", "http:"),
            route.replace("external-xtream.invalid", "blofyplayer.com"),
            route.replace("/live/", "/unknown/"), route.replace("123.ts", "abc.ts"))) {
            assertThrows(IOException::class.java) { transport.resolveRoot(bad.toHttpUrl(), id, credentials) }
        }
    }

    @Test fun originalResolverNeverUsesPaidMediaRouteForExternalLibrary() {
        if (!BuildConfig.CODE_ONLY_LOGIN) return
        val provider = ProviderEntity(id, "External", "https://external-xtream.invalid", "", "")
        val live = StreamEntity("$id:live:123", id, "123", null, "live", "Live")
        val movie = StreamEntity("$id:movie:456", id, "456", null, "movie", "Movie", extension = "mkv")
        val episode = EpisodeEntity("$id:episode:789", id, "22", "789", 1, 1, "Episode")
        val profile = ProviderProfile(providerKey = id)
        val routes = ContentUrlResolver.liveRoute(provider, profile, live)
        assertEquals(transport.route(id,"live","123","ts"), routes.primaryUrl)
        assertEquals(transport.route(id,"live","123","m3u8"), routes.fallbackUrl)
        assertEquals(listOf(routes.primaryUrl, routes.fallbackUrl), ContentUrlResolver.recoveryUrls(live))
        assertEquals(transport.route(id,"movie","456","mkv"), ContentUrlResolver.movie(provider,movie))
        assertEquals(transport.route(id,"series","789","mp4"), ContentUrlResolver.episode(provider,episode))
        assertEquals(listOf(transport.route(id,"series","789","mp4")), ContentUrlResolver.recoveryUrls(episode))
    }
}
