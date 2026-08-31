package tv.blofy.player.data

object CatalogRecoveryPolicy {
    private val recoverableKinds = setOf("movie", "series")

    fun shouldAutoRefresh(
        kind: String,
        itemCount: Int,
        attempted: Boolean,
        refreshInProgress: Boolean
    ): Boolean = kind in recoverableKinds && itemCount == 0 && !attempted && !refreshInProgress
}
