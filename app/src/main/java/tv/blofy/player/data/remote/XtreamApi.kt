package tv.blofy.player.data.remote

import retrofit2.http.GET
import retrofit2.http.Url

interface XtreamApi {
    @GET
    suspend fun list(@Url url: String): List<Map<String, Any?>>

    @GET
    suspend fun objectResponse(@Url url: String): Map<String, Any?>
}
