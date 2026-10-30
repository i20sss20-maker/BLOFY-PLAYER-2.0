package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** A factory reset can change ANDROID_ID; verified recovery must not depend on it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DeviceFactoryResetRecoveryTest {
    @Test
    fun originalBlofyIdCanBeReattachedAfterAndroidIdChanges() {
        val context = RuntimeEnvironment.getApplication()
        val preferences = context.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()

        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "0123456789abcdef")
        val old = DeviceIdentity.deviceId(context)
        assertEquals(old, DeviceIdentity.deriveDeviceId("0123456789abcdef"))

        // Simulate lost local preferences and a *different* Android ID after reset.
        preferences.edit().clear().commit()
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "fedcba9876543210")
        val temporary = DeviceIdentity.deviceId(context)
        val temporaryPin = DeviceIdentity.activationCode(context)
        assertNotEquals(old, temporary)

        // The real app may call this ONLY after the trusted server validates
        // the one-time backup credential or operator ownership verification.
        DeviceIdentity.adoptServerVerifiedRecovery(context, temporary, old, temporaryPin)
        assertEquals(old, DeviceIdentity.deviceId(context))
        assertEquals(temporaryPin, DeviceIdentity.activationCode(context))
    }

    @Test
    fun recoveryRejectsWrongTemporaryDeviceOrPin() {
        val context = RuntimeEnvironment.getApplication()
        val preferences = context.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, "1234567890abcdef")
        val temporary = DeviceIdentity.deviceId(context)
        val pin = DeviceIdentity.activationCode(context)
        val canonical = DeviceIdentity.deriveDeviceId("abcdef1234567890")
        assertThrows(IllegalStateException::class.java) {
            DeviceIdentity.adoptServerVerifiedRecovery(context, "BLOFY-AAAA-AAAA", canonical, pin)
        }
        val incorrect = if (pin == "999999") "111111" else "999999"
        assertThrows(IllegalStateException::class.java) {
            DeviceIdentity.adoptServerVerifiedRecovery(context, temporary, canonical, incorrect)
        }
        assertEquals(temporary, DeviceIdentity.deviceId(context))
    }
}
