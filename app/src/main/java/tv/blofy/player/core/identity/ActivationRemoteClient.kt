package tv.blofy.player.core.identity

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ActivationRemoteClient {
    fun create(baseUrl: String): ActivationApi {
        val normalized = baseUrl.trim().let { if (it.endsWith('/')) it else "$it/" }
        require(normalized.startsWith("https://") || normalized.startsWith("http://")) { "Invalid activation endpoint" }
        val client = OkHttpClient.Builder()
            // Two bounded attempts fit inside the existing login screen deadline.
            .callTimeout(8, TimeUnit.SECONDS)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
        val api = Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ActivationApi::class.java)
        return RetryingActivationApi(api)
    }
}
