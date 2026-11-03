package tv.blofy.player.data

import java.io.EOFException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogSyncFailureMessageTest {
    @Test fun networkEofExplainsBrokenCatalogTransfer() {
        val message = CatalogSyncFailureMessage.describe(
            IllegalStateException("bad response", EOFException("unexpected end of stream"))
        )
        assertTrue(message.contains("انقطع"))
    }
    @Test fun timeoutDoesNotDisplayPrivateUrlOrCredentials() {
        val message = CatalogSyncFailureMessage.describe(
            SocketTimeoutException("timeout to http://user:secret@annkel.com")
        )
        assertTrue(message.contains("مهلة"))
        assertFalse(message.contains("secret"))
        assertFalse(message.contains("annkel.com"))
    }
    @Test fun missingDnsExplainsNetworkError() {
        assertTrue(CatalogSyncFailureMessage.describe(UnknownHostException("host")).contains("الشبكة"))
    }
    @Test fun partialSectionDisplaysSpecificArea() {
        assertTrue(
            CatalogSyncFailureMessage.describe(IllegalStateException("تعذر تحديث: الأفلام")).contains("الأفلام")
        )
    }
}
