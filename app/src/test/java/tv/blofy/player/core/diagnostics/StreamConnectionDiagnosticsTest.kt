package tv.blofy.player.core.diagnostics

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

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

    @Test fun unknownExceptionHasSafeFallback() {
        val cause = StreamConnectionDiagnostics.classify(IllegalStateException("Bearer secret"))
        assertEquals(StreamConnectionDiagnostics.Cause.OTHER, cause)
        assertFalse(StreamConnectionDiagnostics.guidance(cause).contains("secret"))
    }
}
