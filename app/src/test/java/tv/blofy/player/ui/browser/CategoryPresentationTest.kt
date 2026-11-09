package tv.blofy.player.ui.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class CategoryPresentationTest {
    @Test fun smartOrderPrioritizesSportsAndNewsWithoutChangingSourceIDs() {
        val rows = listOf("Armenia", "AR|24/7", "SSC Sports", "World News", "Arabic Movies")
        assertEquals(listOf("SSC Sports", "World News", "Arabic Movies", "Armenia", "AR|24/7"),
            CategoryPresentation.order(rows, true) { it })
        assertEquals(rows, CategoryPresentation.order(rows, false) { it })
    }

    @Test fun categoryOrderIsStableWithinEachGroup() {
        val rows = listOf("Sports 2", "SSC Sports 1", "Other A", "Other B")
        assertEquals(rows, CategoryPresentation.order(rows, true) { it })
    }

    @Test fun longDecorativeHashesDisappearFromTitlesButRealNamesRemain() {
        assertEquals("1001", CategoryPresentation.cleanTitle("####### 1001 #######"))
        assertEquals("AR: LA LIGA HD", CategoryPresentation.cleanTitle("AR: LA LIGA HD"))
        assertEquals("###", CategoryPresentation.cleanTitle("###"))
    }
}
