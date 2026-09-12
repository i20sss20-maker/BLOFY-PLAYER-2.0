package tv.blofy.player.ui.player

import android.app.Application
import android.net.NetworkCapabilities
import androidx.media3.common.Player
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28], application = Application::class)
class PlayerNetworkPolicyTest {
    @Test fun internetNetworkDoesNotRequireAndroidValidationToTryTheProvider() {
        val capabilities = NetworkCapabilities().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        capabilities.removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
    }
    @Test fun validationArrivalDoesNotChangeRetryEligibility() {
        val capabilities = NetworkCapabilities().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
        capabilities.addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
        capabilities.removeCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        assertTrue(PlayerNetworkPolicy.canAttempt(capabilities))
    }
    @Test fun noActiveNetworkOrNoInternetCapabilityIsNotTreatedAsUsable() {
        assertFalse(PlayerNetworkPolicy.canAttempt(null))
        val capabilities = NetworkCapabilities().removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
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
