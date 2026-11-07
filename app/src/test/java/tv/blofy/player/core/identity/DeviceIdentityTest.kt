package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceIdentityTest {
    @Test
    fun generatedDeviceIdUsesBlofyFourByFourFormat() {
        val id = DeviceIdentity.generateDeviceId { 0 }
        assertEquals("BLOFY-AAAA-AAAA", id)
        assertTrue(id.matches(Regex("BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}")))
    }

    @Test
    fun generatedDeviceIdChangesWithInstallationEntropy() {
        val first = DeviceIdentity.generateDeviceId { 0 }
        val second = DeviceIdentity.generateDeviceId { 1 }
        assertNotEquals(first, second)
    }

    @Test
    fun generatedActivationCodeUsesTheFullSixDigitRange() {
        assertEquals("100000", DeviceIdentity.generateActivationCode { bound ->
            assertEquals(900_000, bound)
            0
        })
        assertEquals("999999", DeviceIdentity.generateActivationCode { 899_999 })
    }

    @Test
    fun generatedActivationCodeIsSixNumericDigits() {
        repeat(64) {
            assertTrue(DeviceIdentity.generateActivationCode().matches(Regex("\\d{6}")))
        }
    }

    @Test
    fun trialScopeIsStableAcrossReinstallsButDoesNotExposeAndroidId() {
        val id = "a1b2c3d4e5f60718"
        val first = DeviceIdentity.trialScopeFromAndroidId("tv.blofy.player.v2", id)
        assertTrue(first!!.matches(Regex("[a-f0-9]{64}")))
        assertEquals(first, DeviceIdentity.trialScopeFromAndroidId("tv.blofy.player.v2", id.uppercase()))
        assertNotEquals(first, DeviceIdentity.trialScopeFromAndroidId("tv.blofy.player.v2", "a1b2c3d4e5f60719"))
        assertTrue(!first.contains(id))
    }

    @Test
    fun invalidOrSharedOemAndroidIdCannotStartAnotherAutomaticTrial() {
        for (id in listOf(null, "", "0000000000000000", "9774d56d682e549c", "not-a-device")) {
            assertEquals(null, DeviceIdentity.trialScopeFromAndroidId("tv.blofy.player.v2", id))
        }
    }

    @Test
    fun activationCodeIsNotDerivedFromDeviceId() {
        val first = DeviceIdentity.generateActivationCode { 123_456 }
        val second = DeviceIdentity.generateActivationCode { 654_321 }
        assertNotEquals(first, second)
        assertEquals("223456", first)
        assertEquals("754321", second)
    }
}
