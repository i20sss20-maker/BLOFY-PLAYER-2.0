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
    @Test fun releaseMetadataPrefersDedicatedEndpointThenLegacyHealth() {
        assertEquals(
            listOf(
                "https://updates.example/release.json",
                "https://updates.example/health"
            ),
            AppReleaseRepository.endpointCandidates("https://updates.example/")
        )
    }

    @Test fun largeStreamApkFitsBoundedStreamingDownloadAndChecksumIsVerified() {
        assertTrue(AppUpdateWorker.MAX_BYTES > 292310844L)
        val data = "signed-archive-for-test"
        val expected = java.security.MessageDigest.getInstance("SHA-256")
            .digest(data.toByteArray()).joinToString("") { "%02x".format(it) }
        val file = kotlin.io.path.createTempFile("blofy-stream-update-", ".apk").toFile()
        try {
            file.writeText(data)
            assertTrue(UpdatePackageVerifier.hasSha256(file, expected))
            assertFalse(UpdatePackageVerifier.hasSha256(file, "0".repeat(64)))
            assertFalse(UpdatePackageVerifier.hasSha256(file, "bad"))
            file.appendText("-corrupt")
            assertFalse(UpdatePackageVerifier.hasSha256(file, expected))
        } finally { file.delete() }
    }


}
