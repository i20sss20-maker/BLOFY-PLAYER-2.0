package tv.blofy.player.ui.settings

/**
 * DEBUG-only owner ticket policy. Ticket is never placed into the URI,
 * logged, persisted or added to customer playlists. HTTPS host is pinned.
 */
internal object PrivateHubDeviceQaPolicy {
    private val run = Regex("^mirror_[a-f0-9]{40}$")
    private val ticket = Regex("^v1\\.[A-Za-z0-9_-]{20,450}\\.[A-Za-z0-9_-]{43}$")
    fun approved(mediaKind: String, runId: String, bearer: String,
                 manuallyConfirmed: Boolean): Boolean =
        manuallyConfirmed && (mediaKind == "movie" || mediaKind == "episode") &&
            run.matches(runId) && ticket.matches(bearer)

    fun endpoint(mediaKind: String, runId: String): String {
        require(mediaKind == "movie" || mediaKind == "episode")
        require(run.matches(runId))
        return "https://blofyplayer.com/api/v1/private-device-qa/" +
            mediaKind + "/playback/" + runId
    }
}
