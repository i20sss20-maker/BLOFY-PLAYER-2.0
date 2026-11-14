package tv.blofy.player.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivateMediaQaPolicyTest {
    private fun validWorksheet(
        schema: String = "blofy.private-device-qa-manifest",
        version: Int = 1,
        platform: String = "android_tv",
        expectedPlatform: String = "android_tv",
        privateOnly: Boolean = true,
        readOnly: Boolean = true,
        customerCutover: Boolean = false,
        releaseApproved: Boolean = false,
        appIntegrationCompleted: Boolean = false,
        mediaUrlsIncluded: Boolean = false,
        episodeCount: Int = 10
    ) = PrivateMediaQaPolicy.acceptsWorksheet(
        schema, version, platform, expectedPlatform, privateOnly,
        readOnly, customerCutover, releaseApproved,
        appIntegrationCompleted, mediaUrlsIncluded, episodeCount
    )

    @Test fun acceptsPrivateWorksheetForMatchingAndroidDeviceOnly() {
        assertTrue(validWorksheet())
        assertTrue(validWorksheet(platform = "android", expectedPlatform = "android"))
        assertFalse(validWorksheet(platform = "android", expectedPlatform = "android_tv"))
        assertFalse(validWorksheet(platform = "windows", expectedPlatform = "windows"))
    }

    @Test fun failsClosedForPublicOrCustomerEnablingFlags() {
        assertFalse(validWorksheet(schema = "blofy.playlist"))
        assertFalse(validWorksheet(version = 2))
        assertFalse(validWorksheet(privateOnly = false))
        assertFalse(validWorksheet(readOnly = false))
        assertFalse(validWorksheet(customerCutover = true))
        assertFalse(validWorksheet(releaseApproved = true))
        assertFalse(validWorksheet(appIntegrationCompleted = true))
        assertFalse(validWorksheet(mediaUrlsIncluded = true))
    }

    @Test fun rejectsEmptyOversizedOrMaliciousIdentifiers() {
        assertFalse(validWorksheet(episodeCount = 0))
        assertTrue(validWorksheet(episodeCount = 50))
        assertFalse(validWorksheet(episodeCount = 51))
        assertTrue(PrivateMediaQaPolicy.validSeasonKey("series_42_s01"))
        assertFalse(PrivateMediaQaPolicy.validSeasonKey("series_42_s01/../../admin"))
        assertFalse(PrivateMediaQaPolicy.validSeasonKey("series_000_s01"))
        assertTrue(PrivateMediaQaPolicy.validRunId("season_12345678"))
        assertFalse(PrivateMediaQaPolicy.validRunId("https://evil.test"))
        assertFalse(PrivateMediaQaPolicy.validRunId("../token"))
    }

    @Test fun onlyLocalSystemPickerCanSelectMediaForEligibleEpisode() {
        assertTrue(PrivateMediaQaPolicy.maySelectLocalVideo(true, true, "content"))
        assertFalse(PrivateMediaQaPolicy.maySelectLocalVideo(true, true, "https"))
        assertFalse(PrivateMediaQaPolicy.maySelectLocalVideo(true, true, "file"))
        assertFalse(PrivateMediaQaPolicy.maySelectLocalVideo(true, false, "content"))
        assertFalse(PrivateMediaQaPolicy.maySelectLocalVideo(false, true, "content"))
    }

    @Test fun noObservationExportBeforeActualPlaybackStarted() {
        assertFalse(PrivateMediaQaPolicy.mayExportObservation(true, true, false))
        assertFalse(PrivateMediaQaPolicy.mayExportObservation(true, false, true))
        assertFalse(PrivateMediaQaPolicy.mayExportObservation(false, true, true))
        assertTrue(PrivateMediaQaPolicy.mayExportObservation(true, true, true))
    }
}
