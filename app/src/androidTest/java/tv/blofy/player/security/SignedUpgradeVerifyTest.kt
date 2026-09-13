package tv.blofy.player.security

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.core.identity.DeviceIdentity
import tv.blofy.player.data.local.BlofyDatabase

/** Reads the old real Room data through the new obfuscated application's own API. */
@RunWith(AndroidJUnit4::class)
class SignedUpgradeVerifyTest {
    @Test fun upgradedReleaseReadsExistingEncryptedData() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("signedUpgradeReview") == "true")
        val c = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("tv.blofy.player.v2", c.packageName)
        assertEquals(2000055, c.packageManager.getPackageInfo(c.packageName, 0).versionCode)
        assertEquals(0, c.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        val original = c.getSharedPreferences("blofy_signed_upgrade_review", Context.MODE_PRIVATE)
        assertEquals("rc42-data-retained", original.getString("sentinel", null))
        assertEquals(original.getString("device_id", null), DeviceIdentity.deviceId(c))
        assertEquals(original.getString("pin", null), DeviceIdentity.activationCode(c))
        val dao = BlofyDatabase.get(c).dao()
        val raw = checkNotNull(dao.providerStored("signed-upgrade-qa"))
        assertTrue(raw.password.startsWith("BLOFYENC1:"))
        val opened = checkNotNull(dao.provider("signed-upgrade-qa"))
        assertEquals("BLOFY Upgrade QA", opened.name)
        assertEquals("https://upgrade-test.invalid", opened.baseUrl)
        assertEquals("local-qa-user", opened.username)
        assertEquals("local-qa-password", opened.password)
        val movie = checkNotNull(dao.stream("signed-upgrade-movie"))
        assertTrue(movie.favorite)
        assertTrue(movie.locked)
        assertEquals(60000L, checkNotNull(dao.watchState("signed-upgrade-movie")).positionMs)
    }
}
