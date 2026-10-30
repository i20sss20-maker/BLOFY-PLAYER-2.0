package tv.blofy.player.core.identity

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Recovery is driven by a validated server response, not by a particular
 * Android ID. Android's secure settings are cached differently by TV/OEM
 * devices and Robolectric: inject both derived identities instead of assuming
 * writing Settings.Secure changes the OS's app-scoped ANDROID_ID.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class DeviceFactoryResetRecoveryTest {
    private fun freshContext(): Context {
        val context = RuntimeEnvironment.getApplication()
        context.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE)
            .edit().clear().commit()
        return context
    }

    @Test
    fun originalBlofyIdCanBeReattachedAfterAndroidIdChanges() {
        val context = freshContext()
        val old = DeviceIdentity.deriveDeviceId("old-android-id-before-reset")
        val temporary = DeviceIdentity.deriveDeviceId("new-android-id-after-reset")
        assertNotEquals(old, temporary)

        // Simulate the new installation after wiping the old app state.
        DeviceIdentity.preserveExistingDeviceId(context, temporary)
        val temporaryPin = DeviceIdentity.activationCode(context)
        assertEquals(temporary, DeviceIdentity.deviceId(context))

        // The server must have verified the one-time key or administrator-
        // confirmed ownership before this operation is allowed.
        DeviceIdentity.adoptServerVerifiedRecovery(context, temporary, old, temporaryPin)
        assertEquals(old, DeviceIdentity.deviceId(context))
        assertEquals(temporaryPin, DeviceIdentity.activationCode(context))
    }

    @Test
    fun recoveryRejectsWrongTemporaryDeviceOrPin() {
        val context = freshContext()
        val temporary = DeviceIdentity.deriveDeviceId("fresh-android-device")
        val canonical = DeviceIdentity.deriveDeviceId("previous-android-device")
        DeviceIdentity.preserveExistingDeviceId(context, temporary)
        val pin = DeviceIdentity.activationCode(context)
        assertNotEquals(canonical, temporary)

        assertThrows(IllegalStateException::class.java) {
            DeviceIdentity.adoptServerVerifiedRecovery(context, "BLOFY-AAAA-AAAA", canonical, pin)
        }
        val incorrect = if (pin == "999999") "111111" else "999999"
        assertThrows(IllegalStateException::class.java) {
            DeviceIdentity.adoptServerVerifiedRecovery(context, temporary, canonical, incorrect)
        }
        assertEquals(temporary, DeviceIdentity.deviceId(context))
        assertEquals(pin, DeviceIdentity.activationCode(context))
    }
}
