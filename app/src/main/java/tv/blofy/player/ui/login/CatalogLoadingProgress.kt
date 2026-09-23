package tv.blofy.player.ui.login

import tv.blofy.player.data.PlaylistSyncProgress
import tv.blofy.player.data.PlaylistSyncStage

/** Pure progress mapping so the UI reflects real work instead of compressing all catalog I/O into 0..30%. */
internal object CatalogLoadingProgress {
    const val SERVER_DONE = 8
    const val CONTENT_DONE = 60

    fun download(progress: PlaylistSyncProgress): Int = when (progress.stage) {
        PlaylistSyncStage.LIVE -> mapStage(progress.percentOverride, 18, 30, SERVER_DONE, 20)
        PlaylistSyncStage.MOVIES -> mapStage(progress.percentOverride, 60, 88, 20, 52)
        PlaylistSyncStage.SERIES -> mapStage(progress.percentOverride, 88, 95, 52, CONTENT_DONE)
        PlaylistSyncStage.M3U -> mapStage(progress.percentOverride ?: progress.percent, 0, 100, SERVER_DONE, CONTENT_DONE)
    }

    fun preparation(rawPercent: Int): Int {
        val raw = rawPercent.coerceIn(0, 100)
        return CONTENT_DONE + (raw * (100 - CONTENT_DONE) / 100)
    }

    private fun mapStage(
        rawValue: Int?,
        rawStart: Int,
        rawEnd: Int,
        screenStart: Int,
        screenEnd: Int,
    ): Int {
        if (rawValue == null) return screenStart
        val raw = rawValue.coerceIn(rawStart, rawEnd)
        val rawSpan = (rawEnd - rawStart).coerceAtLeast(1)
        val screenSpan = (screenEnd - screenStart).coerceAtLeast(1)
        return screenStart + ((raw - rawStart) * screenSpan / rawSpan)
    }
}
