package tv.blofy.player.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistSyncTransferProgressTest {
    @Test fun unknownServerLengthDoesNotImplyVerifiedDownloadPercent() {
        val progress = PlaylistSyncProgress(
            stage = PlaylistSyncStage.MOVIES, step = 2, totalSteps = 3,
            parsedItems = 2048, sectionTransferPercent = null
        )
        assertEquals(2048, progress.parsedItems)
        assertNull(progress.sectionTransferPercent)
    }

    @Test fun knownServerLengthReportsSectionPercentAndParsedRowsSeparately() {
        val progress = PlaylistSyncProgress(
            stage = PlaylistSyncStage.SERIES, step = 3, totalSteps = 3,
            parsedItems = 1280, sectionTransferPercent = 75
        )
        assertEquals(75, progress.sectionTransferPercent)
        assertEquals(1280, progress.parsedItems)
    }
}
