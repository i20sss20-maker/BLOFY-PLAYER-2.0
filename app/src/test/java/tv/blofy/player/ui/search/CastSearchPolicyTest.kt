package tv.blofy.player.ui.search

import org.junit.Assert.*
import org.junit.Test
import tv.blofy.player.data.metadata.ProviderMetadata

class CastSearchPolicyTest {
    private fun details(name: String): ProviderMetadata.Metadata =
        ProviderMetadata.Metadata(
            kind = "movie", title = "Example", overview = null,
            rating = null, releaseDate = null, runtimeMinutes = null,
            genres = emptyList(), posterUrl = null, backdropUrl = null,
            logoUrl = null, cast = listOf(ProviderMetadata.Person(1, name, null, null)),
            crew = emptyList()
        )

    @Test fun naturalArabicActorSearchDoesNotRequireExactPrefix() {
        assertTrue(CastSearchPolicy.matches(details("توم كروز"), "افلام بطولة توم كروز"))
        assertTrue(CastSearchPolicy.matches(details("توم كروز"), "أفلام من بطولة توم كروز"))
        assertFalse(CastSearchPolicy.matches(details("توم كروز"), "ليوناردو دي كابريو"))
    }

    @Test fun englishQueriesCanSearchActorOrDirectlyTypedNames() {
        assertTrue(CastSearchPolicy.matches(details("Tom Cruise"), "movies with Tom Cruise"))
        assertTrue(CastSearchPolicy.matches(details("Tom Cruise"), "Tom Cruise"))
        assertEquals("tom", CastSearchPolicy.candidateToken("actor: Tom Cruise"))
    }

    @Test fun twoLetterMinimumPreventsExpensiveBroadScans() {
        assertFalse(CastSearchPolicy.searchable("أ"))
        assertFalse(CastSearchPolicy.matches(details("Tom Cruise"), "T"))
    }

    @Test fun avoidsFakeResultsBasedOnTitleOrGenre() {
        val m = details("Actor B").copy(title = "Tom Cruise", genres = listOf("Action"))
        assertFalse(CastSearchPolicy.matches(m, "Tom Cruise"))
    }
}
