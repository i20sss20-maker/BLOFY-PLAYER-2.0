package tv.blofy.player.ui.settings

/**
 * Pure, unit-testable policy for the isolated local-only QA build.
 * No URL, Hub token, media entitlement or customer configuration is used.
 */
object PrivateMediaQaPolicy {
    private val seasonPattern = Regex("^series_[1-9][0-9]{0,14}_s[0-9]{1,3}$")
    private val runPattern = Regex("^[A-Za-z0-9_-]{8,80}$")

    fun validSeasonKey(key: String) = seasonPattern.matches(key)
    fun validRunId(id: String) = runPattern.matches(id)

    fun acceptsWorksheet(
        schema: String,
        version: Int,
        platform: String,
        expectedPlatform: String,
        privateOnly: Boolean,
        readOnly: Boolean,
        customerCutover: Boolean,
        releaseApproved: Boolean,
        appIntegrationCompleted: Boolean,
        mediaUrlsIncluded: Boolean,
        episodeCount: Int
    ): Boolean =
        schema == "blofy.private-device-qa-manifest" &&
            version == 1 &&
            (platform == "android" || platform == "android_tv") &&
            platform == expectedPlatform &&
            privateOnly && readOnly &&
            !customerCutover && !releaseApproved &&
            !appIntegrationCompleted && !mediaUrlsIncluded &&
            episodeCount in 1..50

    fun maySelectLocalVideo(
        episodeSelected: Boolean,
        candidateForPrivateDeviceTest: Boolean,
        documentScheme: String?
    ): Boolean = episodeSelected &&
        candidateForPrivateDeviceTest &&
        documentScheme == "content"

    fun mayExportObservation(
        episodeSelected: Boolean,
        localVideoSelected: Boolean,
        playingObserved: Boolean
    ): Boolean = episodeSelected && localVideoSelected && playingObserved
}
