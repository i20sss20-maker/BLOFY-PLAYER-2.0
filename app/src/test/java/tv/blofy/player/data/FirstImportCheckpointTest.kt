package tv.blofy.player.data

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class FirstImportCheckpointTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var db: BlofyDatabase
    private val provider = ProviderEntity("p1", "P1", "https://panel.example", "user", "pass")

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(app, BlofyDatabase::class.java).build()
        FirstImportCheckpoint.clear(app, provider.id)
    }

    @After fun tearDown() {
        FirstImportCheckpoint.clear(app, provider.id)
        db.close()
    }

    @Test fun completedLiveSurvivesRestartWhilePartialMovieIsDiscarded() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertCategories(listOf(
            CategoryEntity("p1:live:1", "p1", "1", "live", "Live", 0),
            CategoryEntity("p1:movie:2", "p1", "2", "movie", "Movies", 0)
        ))
        dao.upsertStreams(listOf(
            StreamEntity("p1:live:10", "p1", "10", "1", "live", "Channel"),
            StreamEntity("p1:movie:20", "p1", "20", "2", "movie", "Partial movie")
        ))
        FirstImportCheckpoint.markCompleted(app, provider, "live")

        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, provider)

        assertTrue(state.isCompleted("live"))
        assertFalse(state.isCompleted("movie"))
        assertEquals(1, dao.catalogCountAll("p1", "live"))
        assertEquals(0, dao.catalogCountAll("p1", "movie"))
        assertEquals(1, dao.categorySnapshot("p1", "live").size)
        assertEquals(0, dao.categorySnapshot("p1", "movie").size)
    }

    @Test fun completedMarkerIsRejectedWhenItsRoomRowsAreMissing() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        FirstImportCheckpoint.markCompleted(app, provider, "live")

        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, provider)

        assertFalse(state.isCompleted("live"))
        assertEquals(0, dao.catalogCountAll("p1", "live"))
        assertFalse(FirstImportCheckpoint.state(app, provider).isCompleted("live"))
    }

    @Test fun vanishedCompletedSectionDoesNotDeleteAnotherVerifiedSection() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertCategories(listOf(CategoryEntity("p1:live:1", "p1", "1", "live", "Live", 0)))
        dao.upsertStreams(listOf(StreamEntity("p1:live:10", "p1", "10", "1", "live", "Channel")))
        FirstImportCheckpoint.markCompleted(app, provider, "live")
        FirstImportCheckpoint.markCompleted(app, provider, "movie")

        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, provider)

        assertTrue(state.isCompleted("live"))
        assertFalse(state.isCompleted("movie"))
        assertEquals(1, dao.catalogCountAll("p1", "live"))
        assertFalse(FirstImportCheckpoint.state(app, provider).isCompleted("movie"))
    }

    @Test fun changedSourceInvalidatesOldCheckpointAndClearsEveryUncommittedSection() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertCategories(listOf(CategoryEntity("p1:live:1", "p1", "1", "live", "Live", 0)))
        dao.upsertStreams(listOf(StreamEntity("p1:live:10", "p1", "10", "1", "live", "Channel")))
        FirstImportCheckpoint.markCompleted(app, provider, "live")

        val changed = provider.copy(baseUrl = "https://new-panel.example")
        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, changed)

        assertTrue(state.completed.isEmpty())
        assertEquals(0, dao.catalogCountAll("p1", "live"))
        assertEquals(0, dao.categorySnapshot("p1", "live").size)
    }

    @Test fun changedPasswordInvalidatesOldCheckpointEvenOnSameHostAndUsername() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertCategories(listOf(CategoryEntity("p1:live:1", "p1", "1", "live", "Live", 0)))
        dao.upsertStreams(listOf(StreamEntity("p1:live:10", "p1", "10", "1", "live", "Old account channel")))
        FirstImportCheckpoint.markCompleted(app, provider, "live")

        val rotated = provider.copy(password = "new-pass")
        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, rotated)

        assertTrue(state.completed.isEmpty())
        assertEquals(0, dao.catalogCountAll("p1", "live"))
        assertEquals(0, dao.categorySnapshot("p1", "live").size)
    }

    @Test fun legacyPartialRowsWithoutCheckpointAreClearedOnce() = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        dao.upsertStreams(listOf(StreamEntity("p1:series:30", "p1", "30", "3", "series", "Partial series")))

        val state = FirstImportCheckpoint.discardIncompleteSections(app, dao, provider)

        assertTrue(state.completed.isEmpty())
        assertEquals(0, dao.catalogCountAll("p1", "series"))
    }
}
