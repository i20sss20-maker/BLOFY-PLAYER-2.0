package tv.blofy.player.ui.login

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage

class CatalogLoadingProgressTest {
    @Test fun movieDownloadUsesAUsefulVisibleRange() {
        assertEquals(20, CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 60)
        ))
        val middle = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 74)
        )
        assertTrue(middle in 35..37)
        assertEquals(52, CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 88)
        ))
    }

    @Test fun stagesRemainMonotonicAcrossCatalogAndPreparation() {
        val liveEnd = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.LIVE, 1, 3, 30)
        )
        val moviesStart = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 60)
        )
        val moviesEnd = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.MOVIES, 2, 3, 88)
        )
        val seriesStart = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, 88)
        )
        val seriesEnd = CatalogLoadingProgress.download(
            PlaylistSyncProgress(PlaylistSyncStage.SERIES, 3, 3, 95)
        )

        assertEquals(20, liveEnd)
        assertEquals(20, moviesStart)
        assertEquals(52, moviesEnd)
        assertEquals(52, seriesStart)
        assertEquals(CatalogLoadingProgress.CONTENT_DONE, seriesEnd)
        assertTrue(CatalogLoadingProgress.preparation(34) > seriesEnd)
        assertEquals(100, CatalogLoadingProgress.preparation(100))
    }
}
