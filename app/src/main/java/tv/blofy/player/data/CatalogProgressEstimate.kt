package tv.blofy.player.data

/**
 * Progress shown to the user is an estimate of the THREE catalog sections,
 * not a claim that every server supplied Content-Length. A section contributes
 * at most 30 points; the remaining 5 points require a successful DB commit
 * and local-library preparation. 100% is never emitted before success.
 */
internal object CatalogProgressEstimate {
    fun from(progress: PlaylistSyncProgress): Int {
        // A later section can start even when all previous ones FAILED.
        // Stage index must never masquerade as sections actually downloaded.
        val baseline = 5 + progress.completedSectionCount.coerceIn(0, 3) * 30
        val fraction = progress.sectionTransferPercent?.coerceIn(0, 100)?.toDouble()?.div(100.0)
            ?: when (progress.stage) {
                PlaylistSyncStage.M3U -> 0.0
                PlaylistSyncStage.LIVE -> progress.percentOverride?.let { (it - 18).toDouble() / 12.0 }
                PlaylistSyncStage.MOVIES -> progress.percentOverride?.let { (it - 60).toDouble() / 28.0 }
                PlaylistSyncStage.SERIES -> progress.percentOverride?.let { (it - 88).toDouble() / 7.0 }
            }?.coerceIn(0.0, 1.0)
            ?: 0.0
        return (baseline + fraction * 30).toInt().coerceIn(5, 95)
    }
}
