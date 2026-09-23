package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogStreamingProgressTest {
    @Test fun unknownLengthEstimateDoesNotPlateauEarlyOnHugeCatalogs() {
        val p10k = unknownLengthCatalogFraction(10_000)
        val p50k = unknownLengthCatalogFraction(50_000)
        val p100k = unknownLengthCatalogFraction(100_000)
        val p150k = unknownLengthCatalogFraction(150_000)

        assertTrue(p10k in 0.10..0.25)
        assertTrue(p50k > p10k)
        assertTrue(p100k > p50k)
        assertTrue(p150k > p100k)
        assertTrue(p150k < 0.95)
    }

    @Test fun unknownLengthEstimateIsBoundedUntilExplicitCompletion() {
        assertEquals(0.0, unknownLengthCatalogFraction(0), 0.0)
        assertTrue(unknownLengthCatalogFraction(1_000_000) <= 0.95)
    }
}
