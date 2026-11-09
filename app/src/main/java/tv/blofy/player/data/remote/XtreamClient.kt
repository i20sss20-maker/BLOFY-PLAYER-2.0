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
        .addInterceptor { chain ->
            val request=chain.request()
            val host=request.url.host
            val path=request.url.encodedPath
            val authorization=appContext?.let { StreamCodeSession.authorization(it) }
            if(BuildConfig.CODE_ONLY_LOGIN&&host=="blofyplayer.com" &&
                request.url.scheme=="https" && path=="/player_api.php" && authorization!=null) {
                chain.proceed(request.newBuilder().header("Authorization",authorization).build())
            } else chain.proceed(request)
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
