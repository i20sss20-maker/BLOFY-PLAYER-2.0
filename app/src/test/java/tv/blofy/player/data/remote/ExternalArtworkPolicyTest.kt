package tv.blofy.player.data.remote

import org.junit.Assert.*
import org.junit.Test

class ExternalArtworkPolicyTest {
    @Test fun acceptsOnlyPublicCanonicalImagePaths() {
        for (size in listOf("w500","w780","original","h632")) {
            val url = "https://image.tmdb.org/t/p/$size/abc_DEF-123.jpg"
            assertEquals(url,ExternalArtworkPolicy.safeUrl(url))
        }
    }

    @Test fun externalProviderArtworkAcceptsPublicCdnAndRelativeImagesWithoutSecrets() {
        val host = checkNotNull(tv.blofy.player.core.identity.ExternalStreamConnectClient.parseHost("http://provider.example.com:8080"))
        val credentials = tv.blofy.player.core.identity.ExternalStreamConnectClient.Credentials(host,"fixture-user","fixture-secret")
        for (url in listOf("https://cdn.example.net/posters/cover.jpg","http://provider.example.com:8080/logos/channel.png","https://cdn.example.net/images/abcd?w=500")) {
            assertEquals(url,ExternalArtworkPolicy.providerUrl(url,credentials))
        }
        assertEquals("http://provider.example.com:8080/images/poster.jpg",
            ExternalArtworkPolicy.providerUrl("/images/poster.jpg",credentials))
        for (url in listOf("http://127.0.0.1/poster.jpg","https://router.local/image.jpg",
            "https://cdn.example.net/images/fixture-secret.jpg","https://cdn.example.net/images/a.jpg?password=fixture-secret",
            "https://cdn.example.net/movie/fixture-user/fixture-secret/1.mp4",
            "https://cdn.example.net/posters/a.jpg?token=hidden")) {
            assertNull(url,ExternalArtworkPolicy.providerUrl(url,credentials))
        }
    }

    @Test fun onlyOversizedCanonicalTmdbArtworkIsResized() {
        assertEquals("https://image.tmdb.org/t/p/w500/abc.jpg",
            ExternalArtworkPolicy.preferredDownloadUrl("https://image.tmdb.org/t/p/original/abc.jpg",420))
        assertEquals("https://image.tmdb.org/t/p/w780/abc.jpg",
            ExternalArtworkPolicy.preferredDownloadUrl("https://image.tmdb.org/t/p/original/abc.jpg",640))
        for (url in listOf("https://image.tmdb.org/t/p/w342/abc.jpg","https://cdn.example.net/images/abc.jpg"))
            assertEquals(url,ExternalArtworkPolicy.preferredDownloadUrl(url,420))
    }

    @Test fun rejectsCredentialsPrivateHostsRedirectQueriesAndNonImagePaths() {
        for (url in listOf(
            "http://image.tmdb.org/t/p/w500/abc.jpg",
            "https://image.tmdb.org:8443/t/p/w500/abc.jpg",
            "https://user:pass@image.tmdb.org/t/p/w500/abc.jpg",
            "https://image.tmdb.org/t/p/w500/abc.jpg?password=secret",
            "https://image.tmdb.org/t/p/w500/abc.jpg#secret",
            "https://image.tmdb.org.evil.example.com/t/p/w500/abc.jpg",
            "https://127.0.0.1/t/p/w500/abc.jpg",
            "https://provider.example.com/poster.jpg",
            "https://image.tmdb.org/t/p/w500/user/pass/abc.jpg",
            "https://image.tmdb.org/t/p/w500/abc.svg",
            "https://image.tmdb.org/t/p/w500/abc%2Fdef.jpg"
        )) assertNull(url,ExternalArtworkPolicy.safeUrl(url))
        assertFalse(ExternalArtworkPolicy.client.followRedirects)
        assertFalse(ExternalArtworkPolicy.client.followSslRedirects)
    }
}
