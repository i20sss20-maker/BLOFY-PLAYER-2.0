package tv.blofy.player.core.identity

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35]) // Robolectric 4.14.1 only provides shadows up to API 35
class StreamCodeSessionLogoutTest {
    @Test
    fun logoutClearsLocalSessionButPreservesSameInstallationBinding() {
        val context: Context = RuntimeEnvironment.getApplication()
        val key = StreamCodeSession.installationKey(context)
        val prefs = context.getSharedPreferences(
            "blofy_stream_code_session", Context.MODE_PRIVATE
        )
        assertTrue(prefs.edit()
            .putString("provider_id", StreamCodeSession.providerId)
            .putString("encrypted_bearer", "test-session-placeholder")
            .putLong("activated_at", 12L)
            .putLong("expires_at", 14L)
            .commit())
        assertTrue(StreamCodeSession.isClaimed(context))

        StreamCodeSession.clearClaim(context)

        assertFalse(StreamCodeSession.isClaimed(context))
        assertNull(prefs.getString("provider_id", null))
        assertNull(prefs.getString("encrypted_bearer", null))
        assertFalse(prefs.contains("activated_at"))
        assertFalse(prefs.contains("expires_at"))
        assertEquals(key, StreamCodeSession.installationKey(context))
    }
}
