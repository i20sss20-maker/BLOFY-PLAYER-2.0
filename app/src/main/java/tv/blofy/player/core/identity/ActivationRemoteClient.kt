package tv.blofy.player.core.identity

import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ActivationRemoteClient {
    fun create(baseUrl: String): ActivationApi {
        val candidates = BlofyBackendFallback.candidates(baseUrl)
        val primary = RetryingActivationApi(createSingle(candidates.first()))
        val fallback = candidates.getOrNull(1)?.let { RetryingActivationApi(createSingle(it)) }
        return if (fallback == null) primary else FailoverActivationApi(primary, fallback)
    }

    private fun createSingle(baseUrl: String): ActivationApi {
        val normalized = BlofyBackendFallback.normalize(baseUrl).let { "$it/" }
        require(normalized.startsWith("https://") || normalized.startsWith("http://")) { "Invalid activation endpoint" }
        val client = OkHttpClient.Builder()
            // Two bounded attempts fit inside the existing login screen deadline.
            .callTimeout(8, TimeUnit.SECONDS)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ActivationApi::class.java)
    }

    private class FailoverActivationApi(
        private val primary: ActivationApi,
        private val fallback: ActivationApi
    ) : ActivationApi {
        override suspend fun check(request: ActivationCheckRequest): ActivationCheckResponse =
            failOver { it.check(request) }

        override suspend fun rotate(request: ActivationRotateRequest): ActivationRotateResponse =
            failOver { it.rotate(request) }

        override suspend fun migrateIdentity(
            request: ActivationIdentityMigrationRequest
        ): ActivationIdentityMigrationResponse = failOver { it.migrateIdentity(request) }

        private suspend fun <T> failOver(call: suspend (ActivationApi) -> T): T {
            try {
                return call(primary)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (!BlofyBackendFallback.shouldFailOver(error)) throw error
            }
            return call(fallback)
        }
    }
}
