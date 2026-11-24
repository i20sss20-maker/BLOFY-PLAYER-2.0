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
