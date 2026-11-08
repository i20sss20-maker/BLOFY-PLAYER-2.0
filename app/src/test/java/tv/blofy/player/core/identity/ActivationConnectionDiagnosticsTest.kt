package tv.blofy.player.core.identity

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Test

class ActivationConnectionDiagnosticsTest {
    private val diagnostics = ActivationConnectionDiagnostics
    private val verify = ActivationConnectionDiagnostics.Stage.VERIFICATION
    private val sync = ActivationConnectionDiagnostics.Stage.PLAYLIST_SYNC

    @Test fun networkFailuresHaveStableNonSensitiveCodes() {
        assertEquals("E-A01", diagnostics.classify(UnknownHostException("secret.example"), verify).code)
        assertEquals("E-A02", diagnostics.classify(SSLHandshakeException("cert mismatch"), verify).code)
        assertEquals("E-A03", diagnostics.classify(SocketTimeoutException("timeout"), verify).code)
        assertEquals("E-A04", diagnostics.classify(ConnectException("refused"), verify).code)
        assertEquals("E-A04", diagnostics.classify(IOException("generic"), verify).code)
    }

    @Test fun nestedCausesAndPlaylistStageAreClassifiedWithoutMessages() {
        val nested = IllegalStateException("request url contains credentials", UnknownHostException("secret"))
        assertEquals(ActivationConnectionDiagnostics.Issue.DNS, diagnostics.classify(nested, verify))
        assertEquals(ActivationConnectionDiagnostics.Issue.PLAYLIST, diagnostics.classify(nested, sync))
        assertEquals(ActivationConnectionDiagnostics.Issue.UNKNOWN, diagnostics.classify(IllegalArgumentException("token"), verify))
    }

    @Test fun retryIntervalsRemainBoundedAndProtectRateLimitedServer() {
        assertEquals(8_000L, diagnostics.retryDelayMs(0, null))
        assertEquals(8_000L, diagnostics.retryDelayMs(1, ActivationConnectionDiagnostics.Issue.DNS))
        assertEquals(14_000L, diagnostics.retryDelayMs(2, ActivationConnectionDiagnostics.Issue.TLS))
        assertEquals(25_000L, diagnostics.retryDelayMs(3, ActivationConnectionDiagnostics.Issue.SERVER))
        assertEquals(25_000L, diagnostics.retryDelayMs(100, ActivationConnectionDiagnostics.Issue.SERVER))
        assertEquals(60_000L, diagnostics.retryDelayMs(1, ActivationConnectionDiagnostics.Issue.RATE_LIMIT))
    }
}
