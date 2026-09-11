package tv.blofy.player.core.update

import org.junit.Assert.*
import org.junit.Test

class UpdateSafetyTest {
    @Test fun onlyTheAnnouncedNewerPackageWithTheInstalledSignatureIsAccepted() {
        fun compatible(name: String = "blofy", version: Long = 12L, expected: Int = 12, signatures: Set<String> = setOf("production")) =
            UpdatePackageVerifier.compatible(name, "blofy", version, 11L, expected, signatures, setOf("production"))
        assertTrue(compatible())
        assertFalse(compatible(name = "another.app"))
        assertFalse(compatible(version = 11L, expected = 11))
        assertFalse(compatible(version = 10L, expected = 10))
        assertFalse(compatible(expected = 13))
        assertFalse(compatible(signatures = setOf("debug")))
        assertFalse(compatible(signatures = emptySet()))
        assertFalse(compatible(signatures = setOf("production", "other")))
    }
    @Test fun downloadRequiresHttpsWithoutEmbeddedCredentials() {
        assertTrue(AppUpdateWorker.safeUrl("https://github.com/owner/repo/releases/download/v12/app.apk"))
        assertFalse(AppUpdateWorker.safeUrl("http://example.org/app.apk"))
        assertFalse(AppUpdateWorker.safeUrl("file:///data/app.apk"))
        assertFalse(AppUpdateWorker.safeUrl("https://user:password@example.org/app.apk"))
        assertFalse(AppUpdateWorker.safeUrl("https:///app.apk"))
    }
}
