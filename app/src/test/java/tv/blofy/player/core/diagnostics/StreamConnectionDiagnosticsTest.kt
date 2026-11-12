package tv.blofy.player.core.diagnostics

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response

class StreamConnectionDiagnosticsTest {
    @Test fun wrappedTlsFailureIsNotDisplayedAsJavaException() {
        val error = IOException("https://untrusted.example/secrets", SSLHandshakeException("certificate path"))
        val type = StreamConnectionDiagnostics.classify(error)
        assertEquals(StreamConnectionDiagnostics.Cause.CERTIFICATE, type)
        val advice = StreamConnectionDiagnostics.guidance(type)
        assertTrue(advice.contains("شهادة"))
        assertFalse(advice.contains("https://"))
        assertFalse(advice.contains("javax"))
    }

    @Test fun distinguishDnsTimeoutAndRefusedWithoutRequestData() {
        assertEquals(StreamConnectionDiagnostics.Cause.DNS,
            StreamConnectionDiagnostics.classify(UnknownHostException("dns-host")))
        assertEquals(StreamConnectionDiagnostics.Cause.TIMEOUT,
            StreamConnectionDiagnostics.classify(SocketTimeoutException("timeout")))
        assertEquals(StreamConnectionDiagnostics.Cause.OFFLINE_OR_REFUSED,
            StreamConnectionDiagnostics.classify(ConnectException("refused")))
    }

    @Test fun distinguishUnavailableMediaRateLimitAndAuthenticationWithoutLeakingServerDetails() {
        fun apiError(code: Int): Throwable = IOException("secret provider URL", HttpException(
            Response.error<String>(code, "test body secret".toResponseBody())
        ))
        for (status in listOf(404, 410)) {
            assertEquals(StreamConnectionDiagnostics.Cause.CONTENT_MISSING,
                StreamConnectionDiagnostics.classify(apiError(status)))
        }
        assertEquals(StreamConnectionDiagnostics.Cause.RATE_LIMITED,
            StreamConnectionDiagnostics.classify(apiError(429)))
        assertEquals(StreamConnectionDiagnostics.Cause.UNAUTHORIZED,
            StreamConnectionDiagnostics.classify(apiError(401)))
        assertEquals(StreamConnectionDiagnostics.Cause.TIMEOUT,
            StreamConnectionDiagnostics.classify(apiError(408)))
        assertEquals(StreamConnectionDiagnostics.Cause.SERVER_ERROR,
            StreamConnectionDiagnostics.classify(apiError(503)))
        for (cause in listOf(StreamConnectionDiagnostics.Cause.CONTENT_MISSING,
            StreamConnectionDiagnostics.Cause.RATE_LIMITED)) {
            assertFalse(StreamConnectionDiagnostics.guidance(cause).contains("secret"))
            assertFalse(StreamConnectionDiagnostics.guidance(cause).contains("http://"))
        }
    }

    @Test fun unknownExceptionHasSafeFallback() {
        val cause = StreamConnectionDiagnostics.classify(IllegalStateException("Bearer secret"))
        assertEquals(StreamConnectionDiagnostics.Cause.OTHER, cause)
        assertFalse(StreamConnectionDiagnostics.guidance(cause).contains("secret"))
    }
}
