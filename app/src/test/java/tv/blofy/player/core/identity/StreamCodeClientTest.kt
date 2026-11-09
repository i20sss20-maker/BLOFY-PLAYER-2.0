package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamCodeClientTest {
    @Test fun numericCodeAcceptsArabicAndPersianDigits() {
        assertEquals("12345678",StreamCodeClient.normalizeCode("١٢٣٤٥٦٧٨"))
        assertEquals("12345678",StreamCodeClient.normalizeCode("۱۲۳۴۵۶۷۸"))
        assertEquals("987654321",StreamCodeClient.normalizeCode("987-654-321"))
    }
    @Test fun shortAndInvalidCodesAreRejected() {
        assertEquals("",StreamCodeClient.normalizeCode("1234"))
        assertEquals("",StreamCodeClient.normalizeCode("1234567"))
        assertEquals("",StreamCodeClient.normalizeCode("1234567890123"))
        assertEquals("",StreamCodeClient.normalizeCode("ABCD1234"))
        assertEquals("00123456",StreamCodeClient.normalizeCode("00 123 456"))
    }
    @Test fun legacyCodesKeepParserCompatibility() {
        assertEquals("AB12AB12AB12AB12AB12AB12",
            StreamCodeClient.normalizeCode("ab12-ab12-ab12-ab12-ab12-ab12"))
    }
}