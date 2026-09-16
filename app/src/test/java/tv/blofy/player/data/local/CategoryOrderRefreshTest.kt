package tv.blofy.player.data.local

import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
class CategoryOrderRefreshTest {
    private lateinit var db: BlofyDatabase
    private val saved = ProviderEntity("saved", "Saved", "https://fixture.example.test", "u", "p")
    private val staged = saved.copy(id = "staged", enabled = false)

    @Before
    fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
        val dao = db.dao()
        dao.upsertProviderStored(saved)
        dao.upsertProviderStored(staged)
        dao.upsertCategories(listOf(CategoryEntity("saved:live:10", "saved", "10", "live", "Sports", orderIndex = 70, hidden = true)))
        dao.upsertStreams(listOf(
            stream("saved", "live", 1), stream("saved", "movie", 1), stream("saved", "series", 1),
            stream("staged", "live", 1), stream("staged", "movie", 1), stream("staged", "series", 1)
        ))
        dao.upsertCategories(listOf(CategoryEntity("staged:live:10", "staged", "10", "live", "Sports", orderIndex = 0, hidden = false)))
    }

    @After
    fun cleanup() = db.close()

    @Test
    fun stagedRefresh_keepsUserCategoryVisibilityAndOrder(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().promoteStagedRefresh("staged", saved)

        val category = db.dao().categorySnapshot("saved", "live").single()
        assertTrue(category.hidden)
        assertEquals(70, category.orderIndex)
    }

    private fun stream(providerId: String, kind: String, id: Int) = StreamEntity(
        key = "$providerId:$kind:$id",
        providerId = providerId,
        remoteId = id.toString(),
        categoryId = null,
        kind = kind,
        name = "$kind $id"
    )
}
