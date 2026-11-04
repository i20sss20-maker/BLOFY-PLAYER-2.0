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
    fun stagedRefresh_keepsHiddenFlagButUsesCurrentServerOrder(): Unit = runBlocking(Dispatchers.IO) {
        // Existing category was previously pinned manually (orderIndex=70).
        // A fresh Xtream result is authoritative: its first position is 0.
        db.dao().upsertCategories(listOf(
            CategoryEntity("staged:live:11", "staged", "11", "live", "News", orderIndex = 1)
        ))
        db.dao().promoteStagedRefresh("staged", saved)

        val categories = db.dao().categorySnapshot("saved", "live").sortedBy { it.orderIndex }
        assertEquals(listOf("10", "11"), categories.map { it.remoteId })
        assertTrue(categories[0].hidden)
        assertEquals(0, categories[0].orderIndex)
        assertEquals(1, categories[1].orderIndex)
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
