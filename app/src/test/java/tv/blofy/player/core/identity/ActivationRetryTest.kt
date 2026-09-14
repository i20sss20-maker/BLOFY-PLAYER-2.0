package tv.blofy.player.core.identity

import java.io.IOException
import java.net.ProtocolException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ActivationRetryTest {
    private val request = ActivationCheckRequest("BLOFY-TEST-ONLY", "123456", "test")
    private val active = ActivationCheckResponse("active", serverTime = 1000L)
    private class Fake(private val action: suspend (Int) -> ActivationCheckResponse) : ActivationApi {
        var checks = 0
        var rotations = 0
        val seen = mutableListOf<ActivationCheckRequest>()
        override suspend fun check(request: ActivationCheckRequest): ActivationCheckResponse {
            seen += request
            return action(++checks)
        }
        override suspend fun rotate(request: ActivationRotateRequest): ActivationRotateResponse {
            rotations++
            throw IOException("rotation failure")
        }
    }
    private fun http(code: Int) = HttpException(Response.error<Any>(code, "{}".toResponseBody("application/json".toMediaType())))

    @Test fun transientFailureRecoversWithExactlyOneRetryAndTheSameRequest() = runBlocking {
        for (failure in listOf(IOException("timeout"), http(408), http(500), http(502), http(503), http(504))) {
            val fake = Fake { attempt -> if (attempt == 1) throw failure else active }
            var pauses = 0
            assertSame(active, RetryingActivationApi(fake) { pauses++ }.check(request))
            assertEquals(2, fake.checks)
            assertEquals(1, pauses)
            assertEquals(listOf(request, request), fake.seen)
        }
    }
    @Test fun permanentFailureIsReturnedAfterTwoAttempts() = runBlocking {
        val failure = IOException("still offline")
        val fake = Fake { throw failure }
        try { RetryingActivationApi(fake) {}.check(request); fail("must fail") }
        catch (error: IOException) { assertSame(failure, error) }
        assertEquals(2, fake.checks)
    }
    @Test fun authorizationRateLimitTlsAndMalformedResponsesAreNotRetried() = runBlocking {
        for (failure in listOf(http(400), http(401), http(403), http(404), http(429),
            SSLHandshakeException("untrusted"), ProtocolException("bad HTTP"), IllegalArgumentException("malformed"))) {
            val fake = Fake { throw failure }
            try { RetryingActivationApi(fake) { fail("must not back off") }.check(request); fail("must fail") }
            catch (error: Exception) { assertSame(failure, error) }
            assertEquals(1, fake.checks)
        }
    }
    @Test fun allServerStatusesIncludingExpiredAndBlockedArePreserved() = runBlocking {
        for (status in listOf("active", "trial", "expired", "blocked", "unknown")) {
            val original = ActivationCheckResponse(status, 1234L, 1000L, "server answer")
            val fake = Fake { original }
            assertSame(original, RetryingActivationApi(fake) { fail("no retry") }.check(request))
            assertEquals(1, fake.checks)
        }
    }
    @Test fun cancellationDoesNotBecomeANetworkRetry() = runBlocking {
        val cancelled = CancellationException("user left")
        val fake = Fake { throw cancelled }
        try { RetryingActivationApi(fake) { fail("no retry") }.check(request); fail("must cancel") }
        catch (error: CancellationException) { assertSame(cancelled, error) }
        assertEquals(1, fake.checks)
    }
    @Test fun cancellingDuringBackoffPreventsTheSecondRequest() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val fake = Fake { throw IOException("offline") }
        val api = RetryingActivationApi(fake) { entered.complete(Unit); delay(60000L) }
        val job = launch { api.check(request) }
        entered.await()
        job.cancelAndJoin()
        assertEquals(1, fake.checks)
    }
    @Test fun codeRotationIsDelegatedOnceWithoutRetry() = runBlocking {
        val fake = Fake { active }
        try { RetryingActivationApi(fake) {}.rotate(ActivationRotateRequest("BLOFY-TEST-ONLY", "123456", "654321")); fail("must fail") }
        catch (_: IOException) { }
        assertEquals(1, fake.rotations)
        assertEquals(0, fake.checks)
    }
    @Test fun realRetrofitClientRecoversFrom503AndPreservesBlockedResult() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
            server.enqueue(MockResponse().setBody("{\"status\":\"blocked\",\"serverTime\":1000}"))
            val result = ActivationRemoteClient.create(server.url("/").toString()).check(request)
            assertEquals(ActivationCheckResponse.State.BLOCKED, result.state())
            assertFalse(result.canUse())
            assertEquals(2, server.requestCount)
            val first = server.takeRequest()
            val second = server.takeRequest()
            assertEquals("/api/v1/activation/check", first.path)
            assertEquals(first.body.readUtf8(), second.body.readUtf8())
        } finally { server.shutdown() }
    }
}
