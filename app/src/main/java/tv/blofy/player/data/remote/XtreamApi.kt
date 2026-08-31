package tv.blofy.player.data.remote

import com.google.gson.JsonElement
import okhttp3.ResponseBody
import retrofit2.http.GET
import retrofit2.http.Streaming
import retrofit2.http.Url

interface XtreamApi {
    @GET
    suspend fun list(@Url url: String): List<Map<String, Any?>>

    @GET
    suspend fun objectResponse(@Url url: String): Map<String, Any?>

    /** Streams very large catalog arrays without buffering the complete HTTP body in memory. */
    @Streaming
    @GET
    suspend fun streamingResponse(@Url url: String): ResponseBody

    /**
     * Some Xtream-compatible servers return `get_series_info` as a top-level JSON array
     * (including `[]`) rather than the documented object. Keeping this endpoint separate
     * preserves the stricter map response used by EPG calls while accepting both shapes here.
     */
    @GET
    suspend fun jsonResponse(@Url url: String): JsonElement
}
