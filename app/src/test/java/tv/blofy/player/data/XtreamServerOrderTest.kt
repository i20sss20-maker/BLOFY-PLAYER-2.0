package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class XtreamServerOrderTest {
    @Test fun responseArrayOrderIsAuthoritativeEvenWhenMetadataDisagrees() {
        val rows = listOf(
            mapOf("category_id" to 97, "category_name" to "Alpha", "category_order" to "20"),
            mapOf("category_id" to 5, "category_name" to "Zulu", "category_order" to "2"),
            mapOf("category_id" to 1, "category_name" to "Beta", "category_order" to 3.0)
        )
        assertSame(rows, XtreamServerOrder.categories(rows))
        assertEquals(listOf(97, 5, 1), XtreamServerOrder.categories(rows).map { it["category_id"] })
    }

    @Test fun emptyDuplicateAndMissingOrderingFieldsDoNotTriggerClientSorting() {
        val rows = listOf(
            mapOf("category_id" to "40", "category_name" to "Zulu", "order" to 2),
            mapOf("category_id" to "2", "category_name" to "Alpha", "sort_order" to "0"),
            mapOf("category_id" to "7", "category_name" to "Beta", "sort_order" to "0"),
            mapOf("category_id" to "8", "category_name" to "Bravo")
        )
        assertEquals(rows, XtreamServerOrder.categories(rows))
    }

    @Test fun streamNumbersMustNotReorderLiveMoviesOrSeries() {
        for (kind in listOf("live", "movie", "series")) {
            val first = XtreamServerOrder.streamPosition(mapOf("name" to "Alpha $kind", "num" to 50), 1)
            val second = XtreamServerOrder.streamPosition(mapOf("name" to "Zulu $kind", "num" to 1), 2)
            val third = XtreamServerOrder.streamPosition(mapOf("name" to "Beta $kind"), 3)
            assertEquals(listOf(1L, 2L, 3L), listOf(first, second, third))
        }
    }

    @Test fun failedRowsDoNotChangeOriginalPositionOfFollowingValidRows() {
        // Parser counts every source row, including missing stream_id, before mapping.
        assertEquals(4L, XtreamServerOrder.streamPosition(mapOf("num" to 1), 4))
    }
}
