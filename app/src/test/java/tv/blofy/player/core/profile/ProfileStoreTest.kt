package tv.blofy.player.core.profile

import android.app.Application
import android.content.Context
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28, 35], application = Application::class)
class ProfileStoreTest {
    private val app get() = RuntimeEnvironment.getApplication<Application>()

    @Before fun reset() {
        app.getSharedPreferences("blofy_profiles", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun defaultsIncludeAdultAndKidsAndSelectionIsStable() {
        val profiles = ProfileStore.all(app)
        assertEquals(listOf("main", "kids"), profiles.map { it.id })
        assertFalse(profiles.first().kids)
        assertTrue(profiles.last().kids)
        assertTrue(ProfileStore.select(app, "kids"))
        assertEquals("kids", ProfileStore.active(app).id)
        assertTrue(ProfileStore.isKids(app))
        assertEquals("kids", ProfileStore.storageNamespace(app))
    }

    @Test fun profileNamesAreTrimmedBoundedAndGuestIsUnique() {
        val longName = "  " + "A".repeat(50) + "  "
        val created = ProfileStore.create(app, longName)
        assertEquals(32, created.name.length)
        val guest = ProfileStore.create(app, " Guest ", guest = true)
        assertTrue(guest.guest)
        val duplicate = runCatching { ProfileStore.create(app, "Guest 2", guest = true) }
        assertTrue(duplicate.isFailure)
    }

    @Test fun pinAndActiveDeletionRemainSafe() {
        val profile = ProfileStore.create(app, "Owner")
        ProfileStore.setPin(app, profile.id, "1234")
        val protected = ProfileStore.all(app).first { it.id == profile.id }
        assertTrue(ProfileStore.verifyPin(protected, "1234"))
        assertFalse(ProfileStore.verifyPin(protected, "9999"))
        assertTrue(ProfileStore.select(app, profile.id))
        assertTrue(ProfileStore.delete(app, profile.id))
        assertNotEquals(profile.id, ProfileStore.active(app).id)
    }

    @Test fun invalidPinDoesNotCreateProtection() {
        val profile = ProfileStore.create(app, "No pin")
        ProfileStore.setPin(app, profile.id, "12ab")
        val saved = ProfileStore.all(app).first { it.id == profile.id }
        assertNull(saved.pinHash)
        assertTrue(ProfileStore.verifyPin(saved, "anything"))
    }
}
