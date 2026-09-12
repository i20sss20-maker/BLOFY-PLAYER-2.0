package tv.blofy.player.ui.player

import android.app.Application
import android.net.NetworkCapabilities
import androidx.media3.common.Player
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkCapabilities

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
class PlayerNetworkPolicyTest {
    private fun internetNetwork(): NetworkCapabilities = ShadowNetworkCapabilities.newInstance().also {
        shadowOf(it).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(it).removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    @Test fun internetNetworkDoesNotRequireAndroidValidationToTryTheProvider() {
        assertTrue(PlayerNetworkPolicy.canAttempt(internetNetwork()))
    }
    @Test fun validationArrivalDoesNotChangeRetryEligibility() {
        val capabilities = internetNetwork()
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
        shadowOf(capabilities).addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
        shadowOf(capabilities).removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
    }
    @Test fun noActiveNetworkOrNoInternetCapabilityIsNotTreatedAsUsable() {
        assertFalse(PlayerNetworkPolicy.canAttempt(null))
        val capabilities = ShadowNetworkCapabilities.newInstance()
        shadowOf(capabilities).removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        assertFalse(PlayerNetworkPolicy.canAttempt(capabilities))
    }
    @Test fun bufferingOrReadyPlaybackIsNotRestartedByAReconnectCallbackAlone() {
        for (state in listOf(Player.STATE_BUFFERING, Player.STATE_READY, Player.STATE_ENDED)) {
            assertFalse(PlayerNetworkPolicy.shouldRetryAfterReconnect(false, state))
        }
    }
    @Test fun anIdleOrFailedPlayerRetainsItsExistingRecoveryPath() {
        assertTrue(PlayerNetworkPolicy.shouldRetryAfterReconnect(false, Player.STATE_IDLE))
        for (state in listOf(Player.STATE_IDLE, Player.STATE_BUFFERING, Player.STATE_READY, Player.STATE_ENDED)) {
            assertTrue(PlayerNetworkPolicy.shouldRetryAfterReconnect(true, state))
        }
    }
}
