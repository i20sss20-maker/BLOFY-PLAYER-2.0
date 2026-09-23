package tv.blofy.player.data.metadata

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ProviderDetailsRepositoryTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var server: MockWebServer
    private lateinit var provider: ProviderEntity
    private fun stream(kind: String = "movie") = StreamEntity("${provider.id}:$kind:7", provider.id, "7", "1", kind, "Catalog title")

    @Before fun setup() {
        server = MockWebServer().apply { start() }
        provider = ProviderEntity("details-${System.nanoTime()}", "Test provider", server.url("/").toString(), "user & name", "pass + word")
    }
    @After fun cleanup() { ProviderMetadataCache.clearProvider(context, provider.id); server.shutdown() }

    @Test fun movieFetchesTheSelectedTitleAndReopeningUsesDiskCache() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setBody("""{"info":{"plot":"<p>A story &amp; more.</p>","cast":"Actor One، Actor Two"}}"""))
        val first = ProviderDetailsRepository.refresh(context, provider, stream())
        assertFalse(first.failed)
        assertEquals("A story & more.", first.metadata?.overview)
        assertEquals(listOf("Actor One", "Actor Two"), first.metadata?.cast?.map { it.name })
        val request = server.takeRequest().requestUrl!!
        assertEquals("get_vod_info", request.queryParameter("action"))
        assertEquals("7", request.queryParameter("vod_id"))
        assertEquals(provider.username, request.queryParameter("username"))
        assertEquals(provider.password, request.queryParameter("password"))
        assertEquals(first.metadata, ProviderDetailsRepository.refresh(context, provider, stream()).metadata)
        assertEquals(1, server.requestCount)
    }

    @Test fun seriesLoadsStructuredRolesAndPhotosFromTheProvider() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setBody("""{"info":{"description":"Series story","cast":[{"name":"Actor One","role":"Captain","profile_path":"https://example.test/one.jpg"},"Actor Two"]}}"""))
        val result = ProviderDetailsRepository.refresh(context, provider, stream("series"))
        assertEquals("get_series_info", server.takeRequest().requestUrl!!.queryParameter("action"))
        assertEquals("Series story", result.metadata?.overview)
        assertEquals("Captain", result.metadata?.cast?.first()?.character)
        assertEquals("https://example.test/one.jpg", result.metadata?.cast?.first()?.profileUrl)
        assertEquals("Actor Two", result.metadata?.cast?.last()?.name)
    }

    @Test fun serverFailureAndPartialResponseRetainPreviouslyLoadedStoryAndCast() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setBody("""{"info":{"description":"Saved story","cast":"Saved Actor"}}"""))
        val saved = ProviderDetailsRepository.refresh(context, provider, stream()).metadata
        server.enqueue(MockResponse().setResponseCode(503))
        val offline = ProviderDetailsRepository.refresh(context, provider, stream(), force = true)
        assertTrue(offline.failed)
        assertEquals(saved, offline.metadata)
        server.enqueue(MockResponse().setBody("""{"info":{"name":"Updated title","genre":"Drama"}}"""))
        val partial = ProviderDetailsRepository.refresh(context, provider, stream(), force = true)
        assertFalse(partial.failed)
        assertEquals("Saved story", partial.metadata?.overview)
        assertEquals(saved?.cast, partial.metadata?.cast)
    }

    @Test fun blankInfoDoesNotEraseRootFieldsAndJsonCastPreservesApostrophes() {
        val result = XtreamMetadataFallback.parseResponse(provider, stream(), mapOf(
            "movie_data" to mapOf("description" to "Fallback story", "cast" to """["O'Connor","Actor Two"]"""),
            "info" to mapOf("description" to "", "cast" to emptyList<String>())
        ), "movie")
        assertEquals("Fallback story", result?.overview)
        assertEquals(listOf("O'Connor", "Actor Two"), result?.cast?.map { it.name })
    }

    @Test fun richerActorsAndNestedImagesSurviveDuplicatePlainNames() {
        val result = XtreamMetadataFallback.parseResponse(provider, stream(), mapOf(
            "cast" to "Actor One", "rating_5based" to "4.2",
            "data" to mapOf("info" to mapOf(
                "actors" to listOf(mapOf("name" to "Actor One", "role" to "Captain", "photo" to "/actor.jpg")),
                "images" to mapOf("posters" to listOf(mapOf("file_path" to "/poster.jpg")),
                    "backdrops" to listOf(mapOf("file_path" to "/backdrop.jpg"))),
                "credits" to mapOf("crew" to listOf(mapOf("name" to "Director", "job" to "Director", "profile_path" to "/director.jpg")))
            ))
        ), "movie")!!
        assertEquals(8.4, result.rating!!, 0.001)
        assertEquals(1, result.cast.size)
        assertEquals("Captain", result.cast.single().character)
        assertEquals(server.url("/actor.jpg").toString(), result.cast.single().profileUrl)
        assertEquals(server.url("/poster.jpg").toString(), result.posterUrl)
        assertEquals(server.url("/backdrop.jpg").toString(), result.backdropUrl)
        assertEquals(server.url("/director.jpg").toString(), result.crew.single().profileUrl)
    }

    @Test fun providerCountrySupportsStructuredAndIsoCountryFields() {
        val structured = XtreamMetadataFallback.parseResponse(provider, stream(), mapOf(
            "info" to mapOf(
                "plot" to "Story",
                "production_countries" to listOf(mapOf("iso_3166_1" to "US", "name" to "United States"))
            )
        ), "movie")!!
        assertEquals(listOf("United States"), structured.countries)

        val iso = XtreamMetadataFallback.parseResponse(provider, stream(), mapOf(
            "info" to mapOf("plot" to "Story", "origin_country" to listOf("GB"))
        ), "movie")!!
        assertTrue(iso.countries.single().isNotBlank())
        assertNotEquals("GB", iso.countries.single())
    }

    @Test fun countryOnlyProviderResponseStillBuildsMetadata() {
        val result = XtreamMetadataFallback.parseResponse(provider, stream(), mapOf(
            "info" to mapOf("origin_country" to listOf("SA"))
        ), "movie")
        assertNotNull(result)
        assertTrue(result!!.countries.isNotEmpty())
    }

    @Test fun partialRefreshRetainsRatingArtworkAndRichActorFields() = runBlocking(Dispatchers.IO) {
        server.enqueue(MockResponse().setBody("""{"info":{"rating":8.3,"cover":"https://example.test/poster.jpg","cast":[{"name":"Actor","role":"Captain","photo":"https://example.test/actor.jpg"}]}}"""))
        val saved = ProviderDetailsRepository.refresh(context, provider, stream()).metadata!!
        server.enqueue(MockResponse().setBody("""{"info":{"cast":"Actor","description":"New story"}}"""))
        val updated = ProviderDetailsRepository.refresh(context, provider, stream(), force = true).metadata!!
        assertEquals(saved.rating, updated.rating)
        assertEquals(saved.posterUrl, updated.posterUrl)
        assertEquals(saved.cast, updated.cast)
        assertEquals("New story", updated.overview)
    }

    @Test fun absentCastIsEmptyAndUnsupportedListsMakeNoProviderRequest() = runBlocking(Dispatchers.IO) {
        assertNull(XtreamMetadataFallback.parseResponse(provider, stream(), mapOf("info" to emptyMap<String, Any>()), "movie")?.cast?.firstOrNull())
        assertFalse(ProviderDetailsRepository.refresh(context, provider.copy(providerType = "m3u"), stream()).failed)
        assertEquals(0, server.requestCount)
    }
}
