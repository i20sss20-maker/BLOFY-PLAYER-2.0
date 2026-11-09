package tv.blofy.player.data.remote

import okhttp3.OkHttpClient
import android.content.Context
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.StreamCodeSession
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object XtreamClient {
    @Volatile private var appContext: Context? = null
    fun initialize(context: Context) { appContext=context.applicationContext }

    private val okHttp = OkHttpClient.Builder()
        .addNetworkInterceptor { chain ->
            val request = chain.request()
            if (!BuildConfig.CODE_ONLY_LOGIN) return@addNetworkInterceptor chain.proceed(request)
            // The network interceptor runs once per redirect, so a session
            // bearer never travels to outside hosts, non-HTTPS addresses or
            // paths other than the authenticated BLOFY catalog endpoint.
            val trusted = request.url.scheme == "https" &&
                request.url.host == "blofyplayer.com" &&
                request.url.encodedPath == "/player_api.php"
            val next = request.newBuilder().removeHeader("Authorization")
            if (trusted) {
                appContext?.let { StreamCodeSession.authorization(it) }?.let {
                    next.header("Authorization", it)
                }
            }
            chain.proceed(next.build())
        }
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    val api: XtreamApi by lazy {
        Retrofit.Builder()
            .baseUrl("https://localhost/")
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(XtreamApi::class.java)
    }
}
