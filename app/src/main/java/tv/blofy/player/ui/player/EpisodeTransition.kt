package tv.blofy.player.ui.player

/** Capture the departing episode before either its identity or the player's timeline is reset. */
internal inline fun transitionEpisode(
    automatic: Boolean,
    saveResume: () -> Unit,
    markCompleted: () -> Unit,
    changeEpisode: () -> Unit,
) {
    if (automatic) markCompleted() else saveResume()
    changeEpisode()
}
