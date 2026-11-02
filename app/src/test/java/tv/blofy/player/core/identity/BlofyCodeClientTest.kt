package tv.blofy.player.core.identity

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = tv.blofy.player.data.local.InMemoryKeystoreApplication::class)
class BlofyCodeClientTest {
    private fun payload(host: String = "http://annkel.com:80") = JSONObject().apply {
        put("delivery", "direct")
        put("providerId", "85ca7373-1e4c-4af3-b4d0-e0a297d5ae4f")
        put("baseUrl", host)
        put("username", "user-example")
        put("password", "password-example")
    }

    @Test fun codeBindsOnlyTheOwnerApprovedHostAndKeepsCredentials() {
        val account = BlofyCodeClient.parseAccount(payload())
        assertEquals("BLOFY", account.name)
        assertEquals("http://annkel.com:80", account.baseUrl)
        assertEquals("user-example", account.username)
        assertEquals("password-example", account.password)
    }

    @Test fun aCodeCannotRedirectCredentialsToAnotherHost() {
        for (candidate in listOf(
            "http://evil.example", "https://annkel.com", "http://annkel.com.evil.test",
            "http://user:pass@annkel.com", "http://annkel.com/other",
            "http://annkel.com?x=bad", "http://127.0.0.1",
            "http://annkel.com:8080"
        )) assertThrows(IllegalArgumentException::class.java) {
            BlofyCodeClient.parseAccount(payload(candidate))
        }
        assertThrows(IllegalArgumentException::class.java) {
            BlofyCodeClient.parseAccount(payload().put("delivery", "proxy"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            BlofyCodeClient.parseAccount(payload().put("password", ""))
        }
    }
}
