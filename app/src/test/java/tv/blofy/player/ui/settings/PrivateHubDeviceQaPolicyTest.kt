package tv.blofy.player.ui.settings

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class PrivateHubDeviceQaPolicyTest {
    private val run = "mirror_" + "a".repeat(40)
    private val token = "v1." + "a".repeat(80) + "." + "b".repeat(43)
    @Test fun exactTicketAndRightsRequired() {
        assertTrue(PrivateHubDeviceQaPolicy.approved("movie",run,token,true))
        assertTrue(PrivateHubDeviceQaPolicy.approved("episode",run,token,true))
        assertFalse(PrivateHubDeviceQaPolicy.approved("live",run,token,true))
        assertFalse(PrivateHubDeviceQaPolicy.approved("movie","wrong",token,true))
        assertFalse(PrivateHubDeviceQaPolicy.approved("episode",run,"invalid",true))
        assertFalse(PrivateHubDeviceQaPolicy.approved("episode",run,token,false))
    }
    @Test fun onlyPinnedHttpsOwnerDeviceQaRouteIsConstructed() {
        assertEquals(
            "https://blofyplayer.com/api/v1/private-device-qa/episode/playback/" + run,
            PrivateHubDeviceQaPolicy.endpoint("episode",run))
        assertEquals(
            "https://blofyplayer.com/api/v1/private-device-qa/movie/playback/" + run,
            PrivateHubDeviceQaPolicy.endpoint("movie",run))
    }
    @Test(expected = IllegalArgumentException::class)
    fun noTraversalOrOtherOrigin() {
        PrivateHubDeviceQaPolicy.endpoint("episode","../other")
    }
}
