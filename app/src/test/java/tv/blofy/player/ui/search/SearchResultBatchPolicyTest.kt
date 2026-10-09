package tv.blofy.player.ui.search

import org.junit.Assert.assertEquals
import org.junit.Test

class SearchResultBatchPolicyTest {
    @Test fun firstPaintIsBoundedForLargeCatalogs() {
        assertEquals(18, SearchResultBatchPolicy.nextEnd(0, 120))
        assertEquals(18, SearchResultBatchPolicy.nextEnd(0, 200_000))
    }

    @Test fun subsequentPagesCoverEveryResultWithoutRepeating() {
        assertEquals(36, SearchResultBatchPolicy.nextEnd(18, 50))
        assertEquals(50, SearchResultBatchPolicy.nextEnd(36, 50))
        assertEquals(50, SearchResultBatchPolicy.nextEnd(50, 50))
    }

    @Test fun smallAndInvalidInputsAreSafe() {
        assertEquals(0, SearchResultBatchPolicy.nextEnd(0, 0))
        assertEquals(7, SearchResultBatchPolicy.nextEnd(0, 7))
        assertEquals(18, SearchResultBatchPolicy.nextEnd(-8, 40))
        assertEquals(40, SearchResultBatchPolicy.nextEnd(999, 40))
        assertEquals(0, SearchResultBatchPolicy.nextEnd(0, -1))
    }

    @Test fun largeNumbersDoNotOverflow() {
        assertEquals(Int.MAX_VALUE, SearchResultBatchPolicy.nextEnd(Int.MAX_VALUE - 4, Int.MAX_VALUE))
    }
}
