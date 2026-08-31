package tv.blofy.player.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class XtreamIdentifierTest {
    @Test
    fun integralJsonNumberMatchesStringIdentifier() {
        assertEquals("14", XtreamIdentifier.normalize("14"))
        assertEquals("14", XtreamIdentifier.normalize(14.0))
        assertEquals("14", XtreamIdentifier.normalize(14))
    }

    @Test
    fun preservesTextIdentifiersAndNormalizesDecimalNumbers() {
        assertEquals("0014", XtreamIdentifier.normalize("0014"))
        assertEquals("14.5", XtreamIdentifier.normalize(14.50))
        assertNull(XtreamIdentifier.normalize(null))
        assertNull(XtreamIdentifier.normalize("null"))
    }
}
