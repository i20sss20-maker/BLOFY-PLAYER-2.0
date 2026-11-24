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
    @Test fun providerDirectedCdnAcceptsPublicDnsHostsButNotPrivateOrDowngradedRoutes() {
        val routes = ExternalXtreamMediaRoutes(credentials.host,providerDirectedCdn = true)
        val root = credentials.host.resolve("/live/private-user/private-pass/123.m3u8")!!
        val redirected = routes.redirect(root,"https://cdn.example.net/stream/index.m3u8?sig=private")
        val manifest = routes.rewriteManifest(redirected,"#EXTM3U\nsegment.ts\nhttps://edge.example.net/seg2.ts\n")
        assertFalse(manifest.contains("cdn.example.net"))
        assertFalse(manifest.contains("edge.example.net"))
        val urls = manifest.lineSequence().filter { it.startsWith("https://") }
            .map { routes.resolve(it.toHttpUrl()).toString() }.toList()
        assertEquals(listOf("https://cdn.example.net/stream/segment.ts","https://edge.example.net/seg2.ts"),urls)
        for (bad in listOf("http://cdn.example.net/seg.ts","https://127.0.0.1/seg.ts",
            "https://router.local/seg.ts","https://user:pass@cdn.example.net/seg.ts")) {
            assertThrows(IOException::class.java) { routes.redirect(root,bad) }
        }
    }

    @Test fun catchupRouteIsBoundToProviderAndDoesNotExposeCredentials() {
        val route = transport.catchupRoute(id,"123",60,"2026-11-24:20-00")
        assertFalse(route.contains("private-"))
        assertEquals(listOf("timeshift","private-user","private-pass","60","2026-11-24:20-00","123.ts"),
            transport.resolveRoot(route.toHttpUrl(),id,credentials).pathSegments)
        assertThrows(IOException::class.java) { transport.resolveRoot(route.toHttpUrl(),other,credentials) }
        assertThrows(IllegalArgumentException::class.java) { transport.catchupRoute(id,"123",1441,"2026-11-24:20-00") }
    }

    @Test fun actualMediaHttpTransportFollowsProviderCdnAndResolvesHlsSegments() {
        okhttp3.mockwebserver.MockWebServer().use { server ->
            server.start()
            val origin = server.url("/").newBuilder().host("provider.example.com").build()
            val cdn = origin.newBuilder().host("cdn.example.net").build()
            val profile = ExternalStreamConnectClient.Credentials(origin,"fixture-user","fixture-pass")
            val routes = ExternalXtreamMediaRoutes(origin,providerDirectedCdn=true)
            // Only this fixture transport maps public-looking hostnames to localhost.
            val local = okhttp3.OkHttpClient.Builder().dns(object : okhttp3.Dns {
                override fun lookup(hostname: String): List<java.net.InetAddress> {
                    assertTrue(hostname in setOf("provider.example.com","cdn.example.net"))
                    return listOf(java.net.InetAddress.getByName("127.0.0.1"))
                }
            }).proxy(java.net.Proxy.NO_PROXY).build()
            val http = ExternalStreamConnectCatalog.guardedMediaClientForTransport(routes,local) { url ->
                if (url.pathSegments.firstOrNull()=="native") transport.resolveRoot(url,id,profile)
                else routes.resolve(url)
            }
            val root = transport.route(id,"live","123","m3u8")
            server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(307)
                .setHeader("Location",cdn.resolve("/edge/index.m3u8?sig=fixture")!!))
            server.enqueue(okhttp3.mockwebserver.MockResponse().setHeader("Content-Type","application/vnd.apple.mpegurl")
                .setHeader("Set-Cookie","session=fixture").setBody("#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n"))
            val manifest = http.newCall(okhttp3.Request.Builder().url(root).header("Authorization","Bearer fixture").header("Cookie","x=fixture").build()).execute().use {
                assertEquals(root,it.request.url.toString())
                assertNull(it.header("Set-Cookie"))
                it.body!!.string()
            }
            assertFalse(manifest.contains("cdn.example.net"))
            assertFalse(manifest.contains("fixture"))
            val segment = manifest.lineSequence().single { it.startsWith("https://") }
            val first=server.takeRequest(2,java.util.concurrent.TimeUnit.SECONDS)!!
            assertEquals("/live/fixture-user/fixture-pass/123.m3u8",first.path)
            val second=server.takeRequest(2,java.util.concurrent.TimeUnit.SECONDS)!!
            assertEquals("/edge/index.m3u8?sig=fixture",second.path)
            for (request in listOf(first,second)) {
                assertNull(request.getHeader("Authorization"))
                assertNull(request.getHeader("Cookie"))
            }
            server.enqueue(okhttp3.mockwebserver.MockResponse().setHeader("Content-Type","video/mp2t").setBody("fixture-transport-bytes"))
            http.newCall(okhttp3.Request.Builder().url(segment).build()).execute().use {
                assertEquals("fixture-transport-bytes",it.body!!.string())
            }
            assertEquals("/edge/segment.ts",server.takeRequest(2,java.util.concurrent.TimeUnit.SECONDS)!!.path)
            server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(302).setHeader("Location","http://127.0.0.1/private"))
            assertThrows(IOException::class.java) { http.newCall(okhttp3.Request.Builder().url(root).build()).execute().close() }
            assertEquals(4,server.requestCount)
        }
    }

}
