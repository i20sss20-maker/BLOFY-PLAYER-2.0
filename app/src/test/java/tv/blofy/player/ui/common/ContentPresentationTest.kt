package tv.blofy.player.ui.common

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class ContentPresentationTest {
    @Test fun providerTagsBecomeSeparateBadges() {
        val result = ContentPresentation.of("4K-DE - The Rhythm Section (2020) [HDR]", "movie")
        assertEquals("The Rhythm Section (2020)", result.title)
        assertEquals(listOf("4K", "DE", "HDR"), result.badges)
        val series = ContentPresentation.of("AR-ANM-S - A Livid Lady's Guide (2026) (JP)", "series")
        assertEquals("A Livid Lady's Guide (2026)", series.title)
        assertEquals(listOf("AR", "JP"), series.badges)
    }

    @Test fun legitimateTitlesAndUnknownTagsArePreserved() {
        listOf("Top Gun: Maverick", "TOP GUN", "IT (2017)", "Us (2019)", "1917", "Se7en",
            "Spider-Man: No Way Home", "(500) Days of Summer", "Alien (Director's Cut)",
            "Unknown - A Film", "The 4K Experience", "AR", "[HD]", "S - A Story", "فيلم - قصة جديدة")
            .forEach { assertEquals(it, it, ContentPresentation.title(it)) }
    }

    @Test fun channelNamesRemainUntouchedAndStoredMovieDataIsUnchanged() {
        assertEquals("AR - MBC 1 HD", ContentPresentation.title("AR - MBC 1 HD", "live"))
        val stream = StreamEntity("key", "provider", "id", "movies", "movie", "TOP - Spider Island (2026)")
        assertEquals("Spider Island (2026)", ContentPresentation.of(stream).title)
        assertEquals("TOP - Spider Island (2026)", stream.name)
        assertEquals("key", stream.key)
    }

    @Test fun repeatedBadgesAreDeduplicatedAndFormattingIsIdempotent() {
        val result = ContentPresentation.of("[4K] UHD - Movie [4K]", "movie")
        assertEquals("Movie", result.title)
        assertEquals(listOf("4K"), result.badges)
        assertEquals(result.title, ContentPresentation.title(result.title))
    }
}
