package tv.blofy.player.core.diagnostics

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = android.app.Application::class)
class SubscriptionHealthTest {
    private fun parse(fields: String) = SubscriptionHealth.parse(JSONObject("""{"user_info":{$fields}}"""), 2_000_000L)
    @Test fun authenticatedExpiredAccountIsStillExpired() {
        assertEquals(SubscriptionHealth.State.EXPIRED, parse(""""auth":1,"status":"Expired"""").state)
        assertEquals(SubscriptionHealth.State.EXPIRED, parse(""""auth":1,"status":"Active","exp_date":"1000"""").state)
    }
    @Test fun streamLimitIsDifferentFromExpiryOrBlockedAccess() {
        assertEquals(SubscriptionHealth.State.CONNECTION_LIMIT, parse(""""auth":1,"status":"Active","active_cons":"1","max_connections":"1"""").state)
        assertEquals(SubscriptionHealth.State.BLOCKED, parse(""""auth":1,"status":"Banned","active_cons":0,"max_connections":1""").state)
    }
    @Test fun authenticationFlagAloneDoesNotClaimAnActiveSubscription() {
        assertEquals(SubscriptionHealth.State.UNKNOWN, parse(""""auth":1""").state)
        assertEquals(SubscriptionHealth.State.INVALID, parse(""""auth":0,"status":"Active"""").state)
        assertEquals(SubscriptionHealth.State.UNKNOWN, SubscriptionHealth.parse(JSONObject()).state)
    }
    @Test fun activeAccountReportsExpiryAndAvailableConnections() {
        val result=parse(""""auth":1,"status":"Active","exp_date":3000,"active_cons":0,"max_connections":1""")
        assertEquals(SubscriptionHealth.State.ACTIVE,result.state)
        assertEquals(3_000_000L,result.expiresAt)
        assertEquals(0,result.connections)
        assertEquals(1,result.limit)
    }
}
