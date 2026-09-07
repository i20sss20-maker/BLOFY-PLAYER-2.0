package tv.blofy.player.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRefreshIntegrityPolicyTest {
    @Test fun acceptsNormalCatalogChanges() {
        assertTrue(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 1_000, movies = 10_000, series = 3_000),
            CatalogRefreshIntegrityPolicy.Counts(live = 980, movies = 9_800, series = 3_100)
        ))
    }

    @Test fun rejectsPreviouslyPopulatedSectionBecomingEmpty() {
        assertFalse(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 1_000, movies = 10_000, series = 3_000),
            CatalogRefreshIntegrityPolicy.Counts(live = 1_000, movies = 0, series = 3_000)
        ))
    }

    @Test fun rejectsCatastrophicallyTruncatedLargeSection() {
        assertFalse(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 2_000, movies = 40_000, series = 8_000),
            CatalogRefreshIntegrityPolicy.Counts(live = 2_000, movies = 4_000, series = 8_000)
        ))
    }

    @Test fun rejectsLargeButStillIncompleteHugeSection() {
        assertFalse(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 5_000, movies = 100_000, series = 20_000),
            CatalogRefreshIntegrityPolicy.Counts(live = 5_000, movies = 60_000, series = 20_000)
        ))
    }

    @Test fun acceptsReasonableHugeCatalogChange() {
        assertTrue(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 5_000, movies = 100_000, series = 20_000),
            CatalogRefreshIntegrityPolicy.Counts(live = 4_500, movies = 90_000, series = 18_000)
        ))
    }

    @Test fun keepsModerateCatalogPolicyFlexible() {
        assertTrue(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 200, movies = 500, series = 120),
            CatalogRefreshIntegrityPolicy.Counts(live = 120, movies = 260, series = 70)
        ))
    }

    @Test fun allowsProviderThatLegitimatelyHasNoSectionInBaseline() {
        assertTrue(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 500, movies = 0, series = 0),
            CatalogRefreshIntegrityPolicy.Counts(live = 520, movies = 0, series = 0)
        ))
    }

    @Test fun rejectsCompletelyEmptyCandidate() {
        assertFalse(CatalogRefreshIntegrityPolicy.accepts(
            CatalogRefreshIntegrityPolicy.Counts(live = 0, movies = 0, series = 0),
            CatalogRefreshIntegrityPolicy.Counts(live = 0, movies = 0, series = 0)
        ))
    }
}
