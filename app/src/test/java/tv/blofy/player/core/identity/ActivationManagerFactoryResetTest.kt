package tv.blofy.player.core.identity

import android.content.Context
import android.provider.Settings
import androidx.room.Room
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase

/**
 * Verifies the actual Room + activation refresh code path after Android ID
 * changes on factory reset, not only the preferences helper method.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ActivationManagerFactoryResetTest {
    private val context = RuntimeEnvironment.getApplication()
    private val database = Room.inMemoryDatabaseBuilder(
        context, BlofyDatabase::class.java
    ).allowMainThreadQueries().build()

    @After fun tearDown() {
        database.close()
        context.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test fun trustedAliasResponseRestoresOriginalDeviceIdAndKeepsOriginalExpiry() = runBlocking {
        val pref = context.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE)
        pref.edit().clear().commit()
        val originalAndroidId = "0123456789abcdef"
        val formattedAndroidId = "fedcba9876543210"
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, originalAndroidId)
        val oldBlofyId = DeviceIdentity.deviceId(context)

        // Wipe local preferences, and simulate a system identity change.
        pref.edit().clear().commit()
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ANDROID_ID, formattedAndroidId)
        val temporaryId = DeviceIdentity.deviceId(context)
        assertNotEquals(oldBlofyId, temporaryId)

        val originalExpiry = System.currentTimeMillis() + 29L * 86_400_000L
        val manager = ActivationManager(context, database.dao())
        val provider = object : ActivationApi {
            override suspend fun check(request: ActivationCheckRequest): ActivationCheckResponse {
                if (request.deviceId == temporaryId) {
                    return ActivationCheckResponse(
                        status = "active",
                        expiresAt = originalExpiry,
                        canonicalDeviceId = oldBlofyId,
                        recovered = true
                    )
                }
                return ActivationCheckResponse(status = "active", expiresAt = originalExpiry)
            }
            override suspend fun rotate(request: ActivationRotateRequest) =
                ActivationRotateResponse(rotated = false)
            override suspend fun migrateIdentity(request: ActivationIdentityMigrationRequest) =
                ActivationIdentityMigrationResponse()
        }

        val returned = manager.refresh(provider, "factory-reset-contract")
        assertTrue(returned.recovered)
        assertEquals(oldBlofyId, manager.ensureIdentity().deviceId)
        assertEquals(oldBlofyId, DeviceIdentity.deviceId(context))
        assertEquals(originalExpiry, database.dao().activation()?.expiresAt)

        // Second startup should not silently re-register the disposable trial.
        val checked = manager.refresh(provider, "factory-reset-second-start")
        assertEquals("active", checked.status)
        assertEquals(oldBlofyId, manager.ensureIdentity().deviceId)
        assertEquals(originalExpiry, database.dao().activation()?.expiresAt)
    }
}
