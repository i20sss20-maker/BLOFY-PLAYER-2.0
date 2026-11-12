package tv.blofy.player.ui.catalog

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.local.StreamEntity

class MovieCardMetaTest {
    private fun film(genre: String? = null, categoryId: String? = "new") =
        StreamEntity(key="movie:100", providerId="provider", remoteId="100",
            categoryId=categoryId, kind="movie", name="IN - Sample (2026)", genre=genre)

    @Test fun filmDisplaysProviderClassificationBelowPosterExactlyLikeSeries() {
        assertEquals("Action / Comedy  •  4K  •  AR",
            MovieCardMeta.subtitle(film("Action, Comedy"), listOf("4K","AR"), "IN - NEW RELEASE"))
    }

    @Test fun cachedDetailsSupplyGenreWhenInitialXtreamListOmitsIt() {
        assertEquals("Drama  •  4K  •  AR",
            MovieCardMeta.subtitle(film(), listOf("4K","AR"), "IN - NEW RELEASE", listOf("Drama")))
    }

    @Test fun explicitSourceCategoryIsUsedAsLastClassificationFallback() {
        assertEquals("Horror  •  4K",
            MovieCardMeta.subtitle(film(), listOf("4K"), "TOP MOVIES HORROR"))
    }

    @Test fun newReleaseCategoryCannotBeInventedAsActionComedyOrDrama() {
        assertEquals("Movie  •  4K",
            MovieCardMeta.subtitle(film(), listOf("4K"), "IN - NEW RELEASE"))
    }

    @Test fun providerGenreBeatsConflictingCategoryLabel() {
        assertEquals("Drama  •  4K",
            MovieCardMeta.subtitle(film("Drama"), listOf("4K"), "HORROR MOVIES"))
    }

    @Test fun movieCategoryDisplaysArabicGenresWhenAppIsArabic() {
        assertEquals("أكشن / كوميديا  •  4K",
            MovieCardMeta.subtitle(film("Action, Comedy"), listOf("4K"), null, arabic = true))
        assertEquals("رعب  •  4K",
            MovieCardMeta.subtitle(film(), listOf("4K"), "Horror Movies", arabic = true))
        assertEquals("فيلم  •  4K",
            MovieCardMeta.subtitle(film(), listOf("4K"), "New Releases", arabic = true))
    }

    @Test fun oldSeriesBadgeLineIsPreserved() {
        val series = film("Comedy").copy(kind="series",year=null)
        assertEquals("Comedy  •  4K  •  AR",
            MovieCardMeta.subtitle(series,listOf("4K","AR"),null))
    }

    @Test fun noDuplicateVideoQualityBadges() {
        val label=MovieCardMeta.subtitle(film("Action"), listOf("4K","4K","AR"),"Action")
        assertEquals(1, Regex("4K").findAll(label).count())
        assertTrue(label.startsWith("Action"))
    }
}
