package tv.blofy.player.ui.settings

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.InMemoryKeystoreApplication
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.data.preparation.DatabaseIsolationRule
import tv.blofy.player.ui.search.RecentSearchStore

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
class LocalBackupManagerTest {
    @get:Rule internal val isolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private val db get() = BlofyDatabase.get(app)
    private val category = CategoryEntity("p:movie:c", "p", "c", "movie", "Films", 2)
    private val movie = StreamEntity("p:movie:1", "p", "1", "c", "movie", "Film")
    private val watch = WatchStateEntity(movie.key, "p", "movie", 1000, 60_000, updatedAt = 1)

    @Before fun setup(): Unit = runBlocking(Dispatchers.IO) {
        db.dao().saveAndActivateProvider(ProviderEntity("p", "Provider", "https://example.test", "user", "secret"))
        db.dao().upsertCategories(listOf(category))
        db.dao().upsertStreams(listOf(movie))
        db.dao().saveWatchState(watch)
        app.getSharedPreferences(RuntimeSettings.PREFS, 0).edit().clear().putString(RuntimeSettings.KEY_MOTION, "smooth").commit()
        RecentSearchStore.clear(app)
        RecentSearchStore.record(app, "Existing search")
    }

    private suspend fun backup() = JSONObject(LocalBackupManager.exportJson(app)).apply {
        getJSONArray("categories").getJSONObject(0).put("hidden", true).put("orderIndex", 8)
        put("streamFlags", JSONArray().put(JSONObject().put("kind", "movie").put("remoteId", "1").put("favorite", true).put("locked", true)))
        getJSONArray("watchStates").getJSONObject(0).put("positionMs", 35_000L)
        getJSONObject("settings").put(RuntimeSettings.KEY_MOTION, "reduced")
        put("recentSearches", JSONArray(listOf("Newest", "Older", "newest", "x")))
    }

    @Test fun lateDatabaseFailureRollsBackCategoriesFavoritesLocksAndHistory(): Unit = runBlocking(Dispatchers.IO) {
        val json = backup().toString()
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_restore BEFORE INSERT ON watch_state BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END")
        assertTrue(runCatching { LocalBackupManager.restoreJson(app, json) }.isFailure)
        assertEquals(category, db.dao().allCategoriesForProvider("p").single())
        assertEquals(movie, db.dao().stream(movie.key))
        assertEquals(watch, db.dao().watchState(movie.key))
        assertEquals("smooth", app.getSharedPreferences(RuntimeSettings.PREFS, 0).getString(RuntimeSettings.KEY_MOTION, null))
        assertEquals(listOf("Existing search"), RecentSearchStore.recent(app))
    }

    @Test fun restoresTheBackupWhilePreservingProviderSecretsAndPin(): Unit = runBlocking(Dispatchers.IO) {
        val providerBefore = db.dao().providerStored("p")
        app.getSharedPreferences("blofy_parental", 0).edit().putString("pin_hash", "existing-protected-pin").commit()
        val result = LocalBackupManager.restoreJson(app, backup().toString())
        assertEquals(category.copy(hidden = true, orderIndex = 8), db.dao().allCategoriesForProvider("p").single())
        assertEquals(movie.copy(favorite = true, locked = true), db.dao().stream(movie.key))
        assertEquals(35_000L, db.dao().watchState(movie.key)?.positionMs)
        assertEquals(providerBefore, db.dao().providerStored("p"))
        assertEquals("existing-protected-pin", app.getSharedPreferences("blofy_parental", 0).getString("pin_hash", null))
        assertEquals(listOf("Newest", "Older"), RecentSearchStore.recent(app))
        assertEquals(2, result.searches)
    }

    @Test fun missingOptionalSearchHistoryPreservesExistingSearches(): Unit = runBlocking(Dispatchers.IO) {
        val json = backup().apply { remove("recentSearches") }.toString()
        assertEquals(0, LocalBackupManager.restoreJson(app, json).searches)
        assertEquals(listOf("Existing search"), RecentSearchStore.recent(app))
    }

    @Test fun wrongProviderBackupCannotChangeAnyLocalState(): Unit = runBlocking(Dispatchers.IO) {
        val json = backup().put("providerId", "different-provider").toString()
        assertTrue(runCatching { LocalBackupManager.restoreJson(app, json) }.isFailure)
        assertEquals(category, db.dao().allCategoriesForProvider("p").single())
        assertEquals(movie, db.dao().stream(movie.key))
        assertEquals(watch, db.dao().watchState(movie.key))
    }
}
