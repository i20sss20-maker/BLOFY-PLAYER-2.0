package tv.blofy.player.data.local

import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
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


    @Test
    fun replaceCatalog_followsServerOrderForCategoriesAndAllStreamPages(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        // Deliberately non-alphabetical and non-ID order from the source.
        dao.replaceCatalog(
            saved.id, "live",
            listOf(
                CategoryEntity("saved:live:11", "saved", "11", "live", "News", orderIndex = 0),
                CategoryEntity("saved:live:10", "saved", "10", "live", "Sports", orderIndex = 1)
            ),
            listOf(
                stream("saved", "live", 90).copy(name = "Zulu", categoryId = "10"),
                stream("saved", "live", 12).copy(name = "Bravo", categoryId = "11"),
                stream("saved", "live", 5).copy(name = "Alpha", categoryId = "10")
            )
        )
        val bySource = dao.categorySnapshot(saved.id, "live").sortedBy { it.orderIndex }
        assertEquals(listOf("11", "10"), bySource.map { it.remoteId })
        assertTrue(bySource[1].hidden) // Personal visibility survives, but not old orderIndex.

        val firstPage = dao.catalogSourcePageAfterAll(saved.id, "live", 0L, 2)
        val nextPage = dao.catalogSourcePageAfterAll(saved.id, "live", firstPage.last().sourceOrder, 2)
        assertEquals(listOf("90", "12", "5"), (firstPage + nextPage).map { it.remoteId })
        assertEquals(listOf(1L, 2L, 3L), (firstPage + nextPage).map { it.sourceOrder })
        assertEquals(listOf("90", "5"),
            dao.catalogSourcePageAfterInCategory(saved.id, "live", "10", 0L, 10).map { it.remoteId })
        assertEquals(listOf("90", "5"), dao.streams(saved.id, "live", "10").first().map { it.remoteId })
    }

    @Test
    fun freshSourceRowsRemainOrderedAcrossKindsAndFavoriteEdits(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        for (kind in listOf("live", "movie", "series")) {
            dao.clearStreams(saved.id, kind)
            dao.upsertStreams(listOf(
                stream("saved", kind, 100).copy(name = "Zulu", sourceOrder = 1L),
                stream("saved", kind, 200).copy(name = "Alpha", sourceOrder = 2L)
            ))
            dao.setFavorite("saved:$kind:100", true)
            assertEquals(listOf("100", "200"),
                dao.catalogSourcePageAfterAll(saved.id, kind, 0L, 10).map { it.remoteId })
        }
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
