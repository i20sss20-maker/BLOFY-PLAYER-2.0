package tv.blofy.player.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BlofyUpdateClientTest {
    @Test
    fun parsesActivationStyleReleasePayload() {
        val info = BlofyUpdateClient.parse(
            """{"ok":true,"release":{"app":{"versionCode":2000068,"versionName":"2.0.0-rc07.56","downloadUrl":"https://example.com/app.apk","releaseNotes":"تحسينات"}}}"""
        )
        requireNotNull(info)
        assertEquals(2000068, info.versionCode)
        assertEquals("2.0.0-rc07.56", info.versionName)
        assertEquals("https://example.com/app.apk", info.downloadUrl)
        assertEquals("تحسينات", info.releaseNotes)
    }

    @Test
    fun parsesUpdateServiceReleasePayload() {
        val info = BlofyUpdateClient.parse(
            """{"ok":true,"release":{"versionCode":2000069,"versionName":"2.0.0-rc07.57","downloadUrl":"https://example.com/next.apk"}}"""
        )
        requireNotNull(info)
        assertTrue(BlofyUpdateClient.isUpdateAvailable(2000068, info))
        assertFalse(BlofyUpdateClient.isUpdateAvailable(2000069, info))
    }

    @Test
    fun rejectsUnsafeOrIncompleteMetadata() {
        assertNull(BlofyUpdateClient.parse("""{"release":{"versionCode":1,"versionName":"x","downloadUrl":"http://example.com/a.apk"}}"""))
        assertNull(BlofyUpdateClient.parse("""{"release":{"versionCode":1,"downloadUrl":"https://example.com/a.apk"}}"""))
    }
}
