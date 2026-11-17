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
    @Test fun extremelyLargeLengthCannotOverflowSpaceOrEta() {
        assertFalse(DownloadTransferPolicy.enoughSpace(900_000_000L, Long.MAX_VALUE))
        assertTrue(DownloadTransferPolicy.enoughSpace(Long.MAX_VALUE, 1000L))
        assertEquals(86_400L, DownloadTransferPolicy.secondsRemaining(Long.MAX_VALUE, 0L, 1L))
        assertEquals(1L, DownloadTransferPolicy.secondsRemaining(Long.MAX_VALUE, Long.MAX_VALUE - 1, Long.MAX_VALUE))
        assertNull(DownloadTransferPolicy.secondsRemaining(100L, -1L, 4L))
    }
    @Test fun hugeFilesHaveSafeAccuratePercent() {
        assertEquals(0, DownloadTransferPolicy.percent(0L, Long.MAX_VALUE))
        assertEquals(50, DownloadTransferPolicy.percent(Long.MAX_VALUE / 2, Long.MAX_VALUE))
        assertEquals(100, DownloadTransferPolicy.percent(Long.MAX_VALUE, Long.MAX_VALUE))
        assertEquals(100, DownloadTransferPolicy.percent(999L, 800L))
        assertNull(DownloadTransferPolicy.percent(40L, -1L))
        assertNull(DownloadTransferPolicy.percent(-1L, 100L))
    }

    @Test fun downloadedButMissingFileShowsRecoveryInsteadOfWrongPlayAction() {
        val action = DownloadTransferPolicy::rowAction
        val row = DownloadTransferPolicy.RowAction
        assertEquals(row.PLAY, action(android.app.DownloadManager.STATUS_SUCCESSFUL, true))
        assertEquals(row.EXPLAIN_FAILURE, action(android.app.DownloadManager.STATUS_SUCCESSFUL, false))
        assertEquals(row.EXPLAIN_FAILURE, action(android.app.DownloadManager.STATUS_FAILED, false))
        assertEquals(row.EXPLAIN_FAILURE, action(OfflineDownloadStore.STATUS_MISSING, false))
        assertEquals(row.REMOVE_OR_CANCEL, action(android.app.DownloadManager.STATUS_RUNNING, false))
    }

    @Test fun readyRequiresActualBytesAndAccessibleUri() {
        assertFalse(DownloadTransferPolicy.isValidDownloadedFile(8, 0L, true))
        assertFalse(DownloadTransferPolicy.isValidDownloadedFile(8, 10L, false))
        assertTrue(DownloadTransferPolicy.isValidDownloadedFile(8, 10L, true))
    }
}
