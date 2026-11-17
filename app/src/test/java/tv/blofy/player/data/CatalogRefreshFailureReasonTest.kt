package tv.blofy.player.data

import com.google.gson.JsonSyntaxException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class CatalogRefreshFailureReasonTest {
    private fun http(code: Int) =
        HttpException(Response.error<Unit>(code, "not available".toResponseBody()))

    @Test fun authenticationAndServerFailuresAreSeparate() {
        assertEquals("AUTH", CatalogRefreshFailureReason.code(http(401)))
        assertEquals("AUTH", CatalogRefreshFailureReason.code(http(403)))
        assertEquals("SOURCE_NOT_FOUND", CatalogRefreshFailureReason.code(http(404)))
        assertEquals("RATE_LIMIT", CatalogRefreshFailureReason.code(http(429)))
        assertEquals("SERVER", CatalogRefreshFailureReason.code(http(502)))
    }

    @Test fun interruptedNetworkAndInvalidPayloadAreDistinguished() {
        assertEquals("TIMEOUT", CatalogRefreshFailureReason.code(SocketTimeoutException("secret")))
        assertEquals("DNS", CatalogRefreshFailureReason.code(UnknownHostException("hidden-host")))
        assertEquals("TLS", CatalogRefreshFailureReason.code(SSLHandshakeException("secret")))
        assertEquals("NETWORK", CatalogRefreshFailureReason.code(IOException("secret token")))
        assertEquals("TIMEOUT", CatalogRefreshFailureReason.code(
            JsonSyntaxException(SocketTimeoutException("private-url"))))
        assertEquals("BAD_RESPONSE", CatalogRefreshFailureReason.code(JsonSyntaxException("bad json")))
    }

    @Test fun incompleteAndUnsupportedCategoryResponsesCannotBePromoted() {
        assertEquals("INCOMPLETE", CatalogRefreshFailureReason.code(
            IllegalStateException("Incomplete series catalog section")))
        assertEquals("FILTER_UNSUPPORTED", CatalogRefreshFailureReason.code(
            IllegalStateException("Catalog provider did not honor its category filter")))
    }
}
