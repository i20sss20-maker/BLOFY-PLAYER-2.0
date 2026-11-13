package tv.blofy.player.ui.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadTransferPolicyTest {
    @Test fun honorsHeadroomWithoutTrustingUnknownSize() {
        assertFalse(DownloadTransferPolicy.enoughSpace(500_000_000L, 450_000_000L))
        assertTrue(DownloadTransferPolicy.enoughSpace(2_000_000_000L, 450_000_000L))
        assertTrue(DownloadTransferPolicy.enoughSpace(-1L, 450_000_000L))
    }
    @Test fun speedAndEtaAreBounded() {
        assertEquals(1_000_000L, DownloadTransferPolicy.bytesPerSecond(10_000_000L, 12_000_000L, 2000L))
        assertEquals(8L, DownloadTransferPolicy.secondsRemaining(20_000_000L, 12_000_000L, 1_000_000L))
        assertNull(DownloadTransferPolicy.secondsRemaining(-1L, 5L, 300L))
        assertEquals(0L, DownloadTransferPolicy.bytesPerSecond(200L, 190L, 200L))
    }
    @Test fun readyRequiresActualBytesAndAccessibleUri() {
        assertFalse(DownloadTransferPolicy.isValidDownloadedFile(8, 0L, true))
        assertFalse(DownloadTransferPolicy.isValidDownloadedFile(8, 10L, false))
        assertTrue(DownloadTransferPolicy.isValidDownloadedFile(8, 10L, true))
    }
}
