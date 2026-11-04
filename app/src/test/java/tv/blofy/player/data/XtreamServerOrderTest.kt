package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class XtreamServerOrderTest {
    @Test fun explicitCategoryOrderBeatsAlphabeticAndResponseOrder() {
        val rows = listOf(
            mapOf("category_id" to 97, "category_name" to "Alpha", "category_order" to "20"),
            mapOf("category_id" to 5, "category_name" to "Zulu", "category_order" to "2"),
            mapOf("category_id" to 1, "category_name" to "Beta", "category_order" to 3.0)
        )
        assertEquals(listOf(5, 1, 97), XtreamServerOrder.categories(rows).map { it["category_id"] })
    }

    @Test fun missingOrDuplicateCategoryOrderKeepsExactUpstreamSequence() {
        val unnumbered = listOf(
            mapOf("category_id" to "40", "category_name" to "Zulu"),
            mapOf("category_id" to "2", "category_name" to "Alpha")
        )
        assertEquals(unnumbered, XtreamServerOrder.categories(unnumbered))
        val tied = listOf(
            mapOf("category_id" to "7", "category_order" to "0"),
            mapOf("category_id" to "2", "category_order" to 0)
        )
        assertEquals(tied, XtreamServerOrder.categories(tied))
    }

    @Test fun streamNumberOrderBeatsTitleAndJsonArrayPosition() {
        val first = XtreamServerOrder.streamPosition(mapOf("num" to 20.0), 1)
        val second = XtreamServerOrder.streamPosition(mapOf("num" to "1"), 2)
        assertTrue(second < first)
        assertTrue(XtreamServerOrder.streamPosition(mapOf("num" to "1"), 3) > second)
        val missing = XtreamServerOrder.streamPosition(mapOf("name" to "Zulu"), 4)
        val missingNext = XtreamServerOrder.streamPosition(mapOf("name" to "Alpha"), 5)
        assertTrue(first < missing)
        assertTrue(missing < missingNext)
    }

    @Test fun invalidNumericMetadataUsesOriginalProviderArrayPosition() {
        val negative = XtreamServerOrder.streamPosition(mapOf("num" to "-1"), 2)
        val nonNumeric = XtreamServerOrder.streamPosition(mapOf("num" to "A-Z"), 3)
        assertTrue(negative < nonNumeric)
        val huge = XtreamServerOrder.streamPosition(mapOf("num" to Long.MAX_VALUE), 4)
        assertTrue(nonNumeric < huge)
    }
}
