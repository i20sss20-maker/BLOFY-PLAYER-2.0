package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCatalogRevisionTest {
    @Test fun serverVersionAcceptsGsonNumbersAndRejectsMalformedPayload() {
        assertEquals(15L, StreamCatalogRevision.parseRevision(mapOf(
            "ok" to true, "revision" to 15.0)))
        assertEquals(0L, StreamCatalogRevision.parseRevision(mapOf(
            "ok" to true, "revision" to "0")))
        assertNull(StreamCatalogRevision.parseRevision(mapOf(
            "ok" to false, "revision" to 20)))
        assertNull(StreamCatalogRevision.parseRevision(mapOf(
            "ok" to true, "revision" to -3)))
        assertNull(StreamCatalogRevision.parseRevision(mapOf(
            "ok" to true, "revision" to "12;DROP TABLE")))
    }
    @Test fun neverPromptWithoutCommittedCacheOrWhenServerIsUnchanged() {
        assertFalse(StreamCatalogRevision.updateAvailable(13L, 12L, false))
        assertFalse(StreamCatalogRevision.updateAvailable(null, 12L, true))
        assertFalse(StreamCatalogRevision.updateAvailable(12L, 12L, true))
        assertFalse(StreamCatalogRevision.updateAvailable(11L, 12L, true))
        assertTrue(StreamCatalogRevision.updateAvailable(13L, 12L, true))
        assertTrue(StreamCatalogRevision.updateAvailable(1L, null, true))
    }
}
