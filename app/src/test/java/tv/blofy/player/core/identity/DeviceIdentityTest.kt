package tv.blofy.player.core.identity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceIdentityTest {
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
    fun activationCodeIsNotDerivedFromDeviceId() {
        val first = DeviceIdentity.generateActivationCode { 123_456 }
        val second = DeviceIdentity.generateActivationCode { 654_321 }
        assertNotEquals(first, second)
        assertEquals("223456", first)
        assertEquals("754321", second)
    }
}
