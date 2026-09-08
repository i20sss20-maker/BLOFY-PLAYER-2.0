package tv.blofy.player.data

import android.app.Application
import androidx.room.Room
import com.google.gson.JsonElement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamApi

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class PlaylistManagerPersistenceTest {
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity("candidate", "Candidate", "https://fixture.example.test", "u", "p")

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
    }

    @After fun cleanup() = db.close()

    @Test fun rejectedCategoryPayloadIsReportedAsFailedAndCannotClaimFreshRows(): Unit = runBlocking(Dispatchers.IO) {
        val api = FixtureApi(liveCategories = listOf(mapOf("category_name" to "Missing identifier")))

        val result = PlaylistManager(api, db.dao()).syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
        assertTrue(db.dao().categorySnapshot(provider.id, "live").isEmpty())
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
        assertTrue(db.dao().searchStreamsFts(provider.id, "Live*", 10).isEmpty())
    }

    @Test fun unparseableStreamPayloadCountsAsFailureWhileValidSectionsRemainStaged(): Unit = runBlocking(Dispatchers.IO) {
        val result = PlaylistManager(FixtureApi(liveStreams = "[{\"name\":\"Missing identifier\"}]"), db.dao())
            .syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(0, db.dao().catalogCountAll(provider.id, "live"))
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
    }

    @Test fun rejectedEmptyRefreshKeepsExistingRowsAndReportsFailure(): Unit = runBlocking(Dispatchers.IO) {
        val saved = StreamEntity("candidate:live:saved", provider.id, "saved", null, "live", "Saved live", favorite = true)
        db.dao().replaceCatalog(provider.id, "live", emptyList(), listOf(saved))

        val result = PlaylistManager(FixtureApi(liveCategories = emptyList(), liveStreams = "[]"), db.dao())
            .syncAll(provider)

        assertEquals(1, result.failedSectionCount)
        assertEquals(saved, db.dao().stream(saved.key))
        assertEquals(listOf(saved), db.dao().searchStreamsFts(provider.id, "Saved*", 10))
    }

    @Test fun legitimatelyEmptyNewSectionDoesNotFailOtherSupportedKinds(): Unit = runBlocking(Dispatchers.IO) {
        val result = PlaylistManager(FixtureApi(liveCategories = emptyList(), liveStreams = "[]"), db.dao())
            .syncAll(provider)

        assertEquals(0, result.failedSectionCount)
        assertEquals(2, result.freshItemCount)
        assertEquals(2, db.dao().streamCountForProvider(provider.id))
    }

    private class FixtureApi(
        val liveCategories: List<Map<String, Any?>> = listOf(mapOf("category_id" to "1", "category_name" to "Category")),
        val liveStreams: String = "[{\"stream_id\":1,\"name\":\"Live item\",\"category_id\":1}]"
    ) : XtreamApi {
        override suspend fun list(url: String): List<Map<String, Any?>> =
            if (url.contains("action=get_live_categories")) liveCategories
            else listOf(mapOf("category_id" to "1", "category_name" to "Category"))

        override suspend fun streamingResponse(url: String): ResponseBody {
            val payload = when {
                url.contains("action=get_live_streams") -> liveStreams
                url.contains("action=get_vod_streams") -> "[{\"stream_id\":1,\"name\":\"Movie item\",\"category_id\":1}]"
                else -> "[{\"series_id\":1,\"name\":\"Series item\",\"category_id\":1}]"
            }
            return payload.toResponseBody("application/json".toMediaType())
        }

        override suspend fun objectResponse(url: String): Map<String, Any?> = error("Unexpected EPG request")
        override suspend fun jsonResponse(url: String): JsonElement = error("Unexpected detail request")
    }
}
