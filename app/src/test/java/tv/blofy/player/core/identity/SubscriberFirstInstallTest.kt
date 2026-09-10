package tv.blofy.player.core.identity

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
class SubscriberFirstInstallTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previous: Any? = null

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        previous = singleton.get(null)
        singleton.set(null, db)
        app.getSharedPreferences("blofy_device_identity", Application.MODE_PRIVATE).edit().clear().commit()
    }

    @After fun cleanup() {
        singleton.set(null, previous)
        db.close()
    }

    private fun api(check: suspend (ActivationCheckRequest) -> ActivationCheckResponse) = object : ActivationApi {
        override suspend fun check(request: ActivationCheckRequest) = check.invoke(request)
        override suspend fun rotate(request: ActivationRotateRequest): ActivationRotateResponse = error("Unexpected rotation")
    }

    @Test fun firstSubscriberSubmissionRegistersTheSameIdentityBeforeUsingIt() = runBlocking(Dispatchers.IO) {
        var requested: ActivationCheckRequest? = null
        val identity = BlofySubscriberClient.sessionIdentity(app, api {
            assertNull(requested)
            requested = it
            ActivationCheckResponse("trial", expiresAt = 4102444800000L)
        }, "test")
        assertNotNull(requested)
        assertEquals(identity.deviceId, requested?.deviceId)
        assertEquals(identity.activationCode, requested?.activationCode)
        assertTrue(identity.activated)
        assertEquals(identity, db.dao().activation())
    }

    @Test fun alreadyActiveDeviceKeepsItsIdentityWithoutAnotherCheck() = runBlocking(Dispatchers.IO) {
        val initial = ActivationManager(app, db.dao()).ensureIdentity().copy(activated = true, expiresAt = 4102444800000L)
        db.dao().upsertActivation(initial)
        assertEquals(initial, BlofySubscriberClient.sessionIdentity(app, api { error("Unexpected request") }, "test"))
    }

    @Test fun blockedAndExpiredResponsesCannotAuthorizeASubscriberSession() = runBlocking(Dispatchers.IO) {
        for (status in listOf("blocked", "expired")) {
            try {
                BlofySubscriberClient.sessionIdentity(app, api { ActivationCheckResponse(status) }, "test")
                fail("$status must stop subscriber session creation")
            } catch (_: IllegalStateException) {
                assertFalse(checkNotNull(db.dao().activation()).activated)
            }
        }
    }

    @Test fun failedActivationRemainsRetryableWithoutReplacingTheIdentity() = runBlocking(Dispatchers.IO) {
        val initial = ActivationManager(app, db.dao()).ensureIdentity()
        try {
            BlofySubscriberClient.sessionIdentity(app, api { throw IOException("offline") }, "test")
            fail("A failed check must not authorize a session")
        } catch (_: IOException) {
            assertEquals(initial, db.dao().activation())
        }
        val retried = BlofySubscriberClient.sessionIdentity(app, api { ActivationCheckResponse("active") }, "test")
        assertEquals(initial.deviceId, retried.deviceId)
        assertEquals(initial.activationCode, retried.activationCode)
        assertTrue(retried.activated)
    }
}
