package tv.blofy.player.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Prevents a STREAM update from ever fetching BLOFY PLAYER's different APK. */
class StreamReleaseIsolationTest {
    @Test fun streamNeverUsesPlayerReleaseOrLegacyHealth() {
        val urls = AppReleaseRepository.endpointCandidates("https://updates.blofyplayer.com/", stream = true)
        assertEquals(listOf("https://updates.blofyplayer.com/stream/release.json"), urls)
        assertFalse(urls.any { it.endsWith("/health") || it == "https://updates.blofyplayer.com/release.json" })
    }

    @Test fun originalPlayerReleaseRoutingIsUnchanged() {
        val urls = AppReleaseRepository.endpointCandidates("https://updates.blofyplayer.com", stream = false)
        assertEquals(
            listOf("https://updates.blofyplayer.com/release.json",
                "https://updates.blofyplayer.com/health"),
            urls
        )
    }

    @Test fun onlyHigherBuildCanTriggerFullSignedUpdate() {
        val release = AppReleaseRepository.Release(
            versionCode = 2000085,
            versionName = "2.0.0-rc07.55.8.8-STREAM",
            minSupportedVersionCode = 1,
            downloadUrl = "https://updates.blofyplayer.com/d/blofy-stream",
            releaseNotes = "Audio and safe automatic updates"
        )
        assertTrue(release.updateAvailable(2000084))
        assertFalse(release.updateAvailable(2000085))
        assertFalse(release.updateRequired(2000084))
    }
}
