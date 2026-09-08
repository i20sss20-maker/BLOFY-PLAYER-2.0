package tv.blofy.player.data.local

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.discardStagedCatalogSafely

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogRefreshPersistenceTest {
    private lateinit var db: BlofyDatabase
    private val original = ProviderEntity("saved", "Saved", "https://fixture.example.test", "u", "p")
    private val savedMovie get() = stream(original.id, "movie", 1).copy(favorite = true)
    private val resume = WatchStateEntity("saved:movie:1", original.id, "movie", 45_000L, 180_000L, updatedAt = 123_456L)
    private val activation = ActivationEntity("BLOFY-TEST-ABCD", "123456", activated = true)

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), BlofyDatabase::class.java).build()
        db.dao().upsertProviderStored(original)
        catalog(original.id, live = 5, movies = 1_000, series = 5)
        db.dao().setFavorite(savedMovie.key, true)
        db.dao().saveWatchState(resume)
        db.dao().upsertActivation(activation)
    }

    @After fun cleanup() = db.close()

    private fun stream(providerId: String, kind: String, id: Int) = StreamEntity(
        "$providerId:$kind:$id", providerId, "$id", null, kind, "Saved Item $id"
    )

    private suspend fun catalog(providerId: String, live: Int, movies: Int, series: Int) {
        for ((kind, count) in listOf("live" to live, "movie" to movies, "series" to series)) {
            db.dao().replaceCatalog(providerId, kind, emptyList(), (1..count).map { stream(providerId, kind, it) })
        }
    }

    private suspend fun assertKnownGoodCatalog() {
        val dao = db.dao()
        assertEquals(5, dao.catalogCountAll(original.id, "live"))
        assertEquals(1_000, dao.catalogCountAll(original.id, "movie"))
        assertEquals(5, dao.catalogCountAll(original.id, "series"))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
        assertEquals(resume, dao.watchState(savedMovie.key))
        assertEquals(activation, dao.activation())
        assertEquals(original, dao.provider(original.id))
        assertEquals(10, dao.searchStreamsFts(original.id, "Saved*", 10).size)
    }

    @Test fun missingSectionRejectsPromotionWithoutDeletingSavedRows(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 0, movies = 1_000, series = 5)
        val failure = runCatching { db.dao().promoteStagedRefresh("staged", original) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertKnownGoodCatalog()
        db.dao().discardStagedCatalog("staged")
        assertKnownGoodCatalog()
    }

    @Test fun validButTruncatedLargeSectionRejectsPromotion(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 5, movies = 600, series = 5)
        val failure = runCatching { db.dao().promoteStagedRefresh("staged", original) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertKnownGoodCatalog()
        assertEquals(610, db.dao().streamCountForProvider("staged"))
    }

    @Test fun healthyRefreshPromotesAtomicallyAndKeepsUserState(): Unit = runBlocking(Dispatchers.IO) {
        catalog("staged", live = 6, movies = 1_100, series = 6)
        db.dao().promoteStagedRefresh("staged", original)
        assertEquals(1_112, db.dao().streamCountForProvider(original.id))
        assertEquals(0, db.dao().streamCountForProvider("staged"))
        assertEquals(savedMovie, db.dao().stream(savedMovie.key))
        assertEquals(resume, db.dao().watchState(savedMovie.key))
        assertEquals(activation, db.dao().activation())
        assertEquals(10, db.dao().searchStreamsFts(original.id, "Saved*", 10).size)
    }

    @Test fun backgroundRefreshCannotUndoLaterPlaylistSelectionOrSettings(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        val edited = original.copy(name = "Latest name", liveFormat = "m3u8", updatedAt = original.updatedAt + 10)
        dao.upsertProviderStored(edited)
        val selected = original.copy(id = "selected", name = "Selected")
        dao.saveAndActivateProvider(selected)

        dao.promoteStagedBackgroundRefresh("staged", original, original.copy(updatedAt = original.updatedAt + 1))

        assertEquals(edited.copy(enabled = false), dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider(selected.id)).enabled)
        assertEquals(1_112, dao.streamCountForProvider(original.id))
    }

    @Test fun pendingSourceBackgroundRefreshKeepsOtherPlaylistSelected(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        val episode = EpisodeEntity("saved:episode:10", original.id, "1", "10", 1, 1, "Episode")
        dao.upsertEpisodes(listOf(episode))
        dao.saveAndActivateProvider(original.copy(id = "selected"))
        val replacement = original.copy(baseUrl = "https://replacement.example.test", password = "changed")

        dao.promoteStagedBackgroundRefresh("staged", original, replacement)

        assertEquals(replacement.copy(enabled = false), dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
        assertNull(dao.episode(episode.key))
    }

    @Test fun staleBackgroundSourceCannotOverwriteEditedProviderOrCatalog(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        val edited = original.copy(password = "new credential")
        dao.upsertProviderStored(edited)

        assertTrue(runCatching { dao.promoteStagedBackgroundRefresh("staged", original, original) }.isFailure)

        assertEquals(edited, dao.provider(original.id))
        assertEquals(1_010, dao.streamCountForProvider(original.id))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
        assertEquals(1_112, dao.streamCountForProvider("staged"))
    }

    @Test fun backgroundRefreshCannotRecreateDeletedProvider(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        dao.deleteProvider(original.id)

        assertTrue(runCatching { dao.promoteStagedBackgroundRefresh("staged", original, original) }.isFailure)

        assertNull(dao.provider(original.id))
        assertEquals(1_010, dao.streamCountForProvider(original.id))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
    }

    @Test fun foregroundRefreshRejectsStaleSourceWithoutChangingSelection(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        val edited = original.copy(baseUrl = "https://latest.example.test")
        dao.upsertProviderStored(edited)
        dao.saveAndActivateProvider(original.copy(id = "selected"))

        assertTrue(runCatching {
            dao.promoteStagedRefresh("staged", original, expectedSource = original)
        }.isFailure)

        assertEquals(edited.copy(enabled = false), dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
        assertEquals(1_010, dao.streamCountForProvider(original.id))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
    }

    @Test fun foregroundRefreshCannotRecreateDeletedProvider(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        dao.deleteProvider(original.id)
        dao.saveAndActivateProvider(original.copy(id = "selected"))

        assertTrue(runCatching {
            dao.promoteStagedRefresh("staged", original, expectedSource = original)
        }.isFailure)

        assertNull(dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
        assertEquals(1_010, dao.streamCountForProvider(original.id))
    }

    @Test fun guardedForegroundRefreshStillSelectsExplicitTarget(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        dao.saveAndActivateProvider(original.copy(id = "selected"))

        dao.promoteStagedRefresh("staged", original, expectedSource = original)

        assertTrue(checkNotNull(dao.provider(original.id)).enabled)
        assertFalse(checkNotNull(dao.provider("selected")).enabled)
        assertEquals(1_112, dao.streamCountForProvider(original.id))
    }

    @Test fun guardedForegroundRefreshKeepsPreferencesEditedWhileImportWasRunning(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 6, movies = 1_100, series = 6)
        val edited = original.copy(
            name = "Renamed during import", liveFormat = "m3u8", preferredTransport = "okhttp",
            preferredEngine = "manual-engine", allowCrossProtocolRedirects = false,
            updatedAt = original.updatedAt + 100
        )
        dao.upsertProviderStored(edited)
        dao.saveAndActivateProvider(original.copy(id = "selected"))
        val candidate = original.copy(baseUrl = "https://replacement.example.test", password = "new source")

        dao.promoteStagedRefresh("staged", candidate, expectedSource = original)

        assertEquals(edited.copy(baseUrl = candidate.baseUrl, password = candidate.password), dao.provider(original.id))
        assertFalse(checkNotNull(dao.provider("selected")).enabled)
    }

    @Test fun delayedProfileResultKeepsCurrentSelectionAndIndividualUserEdits(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val edited = original.copy(
            name = "Latest name", liveFormat = "m3u8", preferredEngine = "manual-engine",
            enabled = false, updatedAt = original.updatedAt + 100
        )
        dao.upsertProviderStored(edited)
        val profile = original.copy(
            liveFormat = "network-format", preferredTransport = "okhttp", preferredEngine = "network-engine",
            allowCrossProtocolRedirects = false
        )

        assertTrue(dao.mergeProviderProfileIfSourceUnchanged(original, profile))

        assertEquals(edited.copy(preferredTransport = "okhttp", allowCrossProtocolRedirects = false), dao.provider(original.id))
    }

    @Test fun delayedProfileResultCannotReplaceCredentialsOrRecreateDeletedProvider(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val edited = original.copy(password = "new credentials")
        dao.upsertProviderStored(edited)

        assertFalse(dao.mergeProviderProfileIfSourceUnchanged(original, original.copy(liveFormat = "m3u8")))
        assertEquals(edited, dao.provider(original.id))

        dao.deleteProvider(original.id)
        assertFalse(dao.mergeProviderProfileIfSourceUnchanged(original, original.copy(liveFormat = "m3u8")))
        assertNull(dao.provider(original.id))
    }

    @Test fun explicitAccountReplacementAllowsSmallerCatalogAndKeepsLatestPreferences(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 1, movies = 2, series = 0)
        val episode = EpisodeEntity("saved:episode:10", original.id, "1", "10", 1, 1, "Old account episode")
        dao.upsertEpisodes(listOf(episode))
        val latest = original.copy(name = "Latest name", liveFormat = "m3u8", preferredEngine = "manual-engine")
        dao.upsertProviderStored(latest)
        dao.saveAndActivateProvider(original.copy(id = "selected"))
        val replacement = original.copy(username = "new account", password = "new token")

        // Ordinary refresh/background still reject a missing section and drastic size reduction.
        assertTrue(runCatching {
            dao.promoteStagedRefresh("staged", replacement, expectedSource = original)
        }.isFailure)
        assertEquals(1_010, dao.streamCountForProvider(original.id))

        dao.promoteExplicitSourceReplacement("staged", replacement, original)

        assertEquals(3, dao.streamCountForProvider(original.id))
        assertEquals(0, dao.streamCountForProvider("staged"))
        assertEquals(latest.copy(username = replacement.username, password = replacement.password), dao.provider(original.id))
        assertFalse(checkNotNull(dao.provider("selected")).enabled)
        assertNull(dao.episode(episode.key))
        assertEquals(resume, dao.watchState(savedMovie.key))
        assertEquals(activation, dao.activation())
        assertEquals(3, dao.searchStreamsFts(original.id, "Saved*", 10).size)
    }

    @Test fun explicitReplacementCannotBypassSameSourceOrPromoteEmptyCandidate(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 1, movies = 2, series = 0)
        assertTrue(runCatching {
            dao.promoteExplicitSourceReplacement("staged", original, original)
        }.isFailure)
        assertKnownGoodCatalog()

        assertTrue(runCatching {
            dao.promoteExplicitSourceReplacement("empty", original.copy(password = "different"), original)
        }.isFailure)
        assertKnownGoodCatalog()
    }

    @Test fun explicitReplacementCannotOverwriteNewerSourceOrRecreateDeletedProvider(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        catalog("staged", live = 1, movies = 2, series = 0)
        val newer = original.copy(password = "newer account")
        dao.upsertProviderStored(newer)
        dao.saveAndActivateProvider(original.copy(id = "selected"))
        val requested = original.copy(password = "requested account")

        assertTrue(runCatching {
            dao.promoteExplicitSourceReplacement("staged", requested, original)
        }.isFailure)
        assertEquals(newer.copy(enabled = false), dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
        assertEquals(1_010, dao.streamCountForProvider(original.id))

        dao.deleteProvider(original.id)
        assertTrue(runCatching {
            dao.promoteExplicitSourceReplacement("staged", requested, original)
        }.isFailure)
        assertNull(dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
    }

    @Test fun firstImportActivationRejectsEditedAndDeletedTargets(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val edited = original.copy(password = "new source password")
        dao.upsertProviderStored(edited)
        dao.saveAndActivateProvider(original.copy(id = "selected"))

        assertTrue(runCatching { dao.activateImportedProvider(original) }.isFailure)
        assertEquals(edited.copy(enabled = false), dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)

        dao.deleteProvider(original.id)
        assertTrue(runCatching { dao.activateImportedProvider(original) }.isFailure)
        assertNull(dao.provider(original.id))
        assertTrue(checkNotNull(dao.provider("selected")).enabled)
    }

    @Test fun canceledFirstImportCannotClearNewSourceOrNewerCommittedRows(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        assertFalse(dao.discardUncommittedCatalogIfSourceUnchanged(original) { false })
        assertKnownGoodCatalog()
        dao.upsertProviderStored(original.copy(password = "new source"))
        assertFalse(dao.discardUncommittedCatalogIfSourceUnchanged(original))
        assertEquals(1_010, dao.streamCountForProvider(original.id))
        dao.upsertProviderStored(original.copy(updatedAt = original.updatedAt + 1))
        assertFalse(dao.discardUncommittedCatalogIfSourceUnchanged(original))
        assertEquals(savedMovie, dao.stream(savedMovie.key))
        dao.upsertProviderStored(original)
        assertTrue(dao.discardUncommittedCatalogIfSourceUnchanged(original))
        assertEquals(0, dao.streamCountForProvider(original.id))
    }

    @Test fun sameSourceRefreshRetainsEpisodesAndResumeOnlyForRemainingSeries(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val retained = EpisodeEntity("saved:episode:10", original.id, "1", "10", 1, 1, "Episode")
        val removed = retained.copy(key = "saved:episode:50", seriesId = "5", remoteId = "50")
        val episodeResume = resume.copy(contentKey = retained.key, kind = "episode")
        dao.upsertEpisodes(listOf(retained, removed))
        dao.saveWatchState(episodeResume)
        catalog("staged", live = 6, movies = 1_100, series = 4)

        dao.promoteStagedRefresh("staged", original)

        assertEquals(retained, dao.episode(retained.key))
        assertNull(dao.episode(removed.key))
        assertEquals(listOf(episodeResume), dao.watchStatesForSeries(original.id, "1"))
        assertEquals(episodeResume, dao.watchState(retained.key))
    }

    @Test fun cancellationDiscardsEveryStagedTableWithoutTouchingSavedCatalog(): Unit = runBlocking(Dispatchers.IO) {
        val dao = db.dao()
        val started = CompletableDeferred<Unit>()
        val import = launch {
            try {
                dao.upsertProviderStored(original.copy(id = "staged", enabled = false))
                catalog("staged", live = 2, movies = 1_405, series = 2)
                dao.upsertCategories(listOf(CategoryEntity("staged:live:c", "staged", "c", "live", "Category")))
                started.complete(Unit)
                awaitCancellation()
            } finally {
                discardStagedCatalogSafely(dao, "staged")
            }
        }
        started.await()
        import.cancelAndJoin()

        assertTrue(import.isCancelled)
        assertEquals(0, dao.streamCountForProvider("staged"))
        assertTrue(dao.allCategoriesForProvider("staged").isEmpty())
        assertFalse(dao.hasSearchIndex("staged"))
        assertNull(dao.provider("staged"))
        assertKnownGoodCatalog()
    }
}
