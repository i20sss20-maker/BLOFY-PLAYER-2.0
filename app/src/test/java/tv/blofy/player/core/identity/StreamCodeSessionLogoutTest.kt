package tv.blofy.player.core.identity

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Logout must never rotate a redeemed TV's installation binding. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class StreamCodeSessionLogoutTest {
    @Test fun localLogoutRemovesBearerAndClaimButPreservesInstallationId() {
        val context = RuntimeEnvironment.getApplication()
        val installKey = StreamCodeSession.installationKey(context)
        val prefs = context.getSharedPreferences("blofy_stream_code_session", Context.MODE_PRIVATE)
        assertTrue(prefs.edit()
            .putString("provider_id", StreamCodeSession.providerId)
            .putString("encrypted_bearer", "fake-session-token")
            .putLong("activated_at", 1L)
            .putLong("expires_at", 2L)
            .commit())
        assertTrue(StreamCodeSession.isClaimed(context))
        StreamCodeSession.clearClaim(context)
        assertFalse(StreamCodeSession.isClaimed(context))
        assertFalse(prefs.contains("encrypted_bearer"))
        assertFalse(prefs.contains("expires_at"))
        assertEquals(installKey, StreamCodeSession.installationKey(context))
    }
}
