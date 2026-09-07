package tv.blofy.player.data.profile

import android.app.Application
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [23, 28, 35], application = Application::class)
class ProfileLibraryStoreTest {
    private val app get() = RuntimeEnvironment.getApplication()

    @Before fun reset() {
        app.getSharedPreferences("blofy_profile_library_v1", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun watchlistAndHiddenCategoriesAreStrictlyProfileScoped() {
        assertTrue(ProfileLibraryStore.setWatchlisted(app, "movie:1", true, "p1"))
        assertTrue(ProfileLibraryStore.setCategoryHidden(app, "cat:adult", true, "p1"))
        assertTrue(ProfileLibraryStore.isWatchlisted(app, "movie:1", "p1"))
        assertFalse(ProfileLibraryStore.isWatchlisted(app, "movie:1", "p2"))
        assertTrue("cat:adult" in ProfileLibraryStore.hiddenCategories(app, "p1"))
        assertFalse("cat:adult" in ProfileLibraryStore.hiddenCategories(app, "p2"))
    }

    @Test fun watchlistKeepsNewestFiveHundredItems() {
        repeat(507) { index -> ProfileLibraryStore.setWatchlisted(app, "movie:$index", true, "bulk") }
        val items = ProfileLibraryStore.watchlist(app, "bulk")
        assertEquals(500, items.size)
        assertFalse("movie:0" in items)
        assertTrue("movie:506" in items)
    }

    @Test fun homeRowsRejectUnknownDuplicatesAndPreserveOrder() {
        val allowed = ProfileLibraryStore.ALL_HOME_ROWS.take(3)
        assertTrue(ProfileLibraryStore.saveHomeRows(app, listOf(allowed[1], "unknown", allowed[0], allowed[1], allowed[2]), "p1"))
        assertEquals(listOf(allowed[1], allowed[0], allowed[2]), ProfileLibraryStore.homeRows(app, "p1"))
        assertTrue(ProfileLibraryStore.moveHomeRow(app, allowed[0], -1, "p1"))
        assertEquals(listOf(allowed[0], allowed[1], allowed[2]), ProfileLibraryStore.homeRows(app, "p1"))
    }

    @Test fun cloudRestoreSanitizesSettingsRowsAndCapsLists() {
        val watch = JSONArray().apply { repeat(520) { put("w:$it") } }
        val hidden = JSONArray().apply { repeat(510) { put("h:$it") } }
        val rows = JSONArray().apply {
            put("invalid")
            ProfileLibraryStore.ALL_HOME_ROWS.take(2).forEach(::put)
            put(ProfileLibraryStore.ALL_HOME_ROWS.first())
        }
        val settings = JSONObject().apply {
            put("safe.key", "x".repeat(300))
            put("unsafe key", true)
            put("enabled", true)
        }
        val payload = JSONObject()
            .put("watchlist", watch)
            .put("hiddenCategories", hidden)
            .put("homeRows", rows)
            .put("settings", settings)

        assertTrue(ProfileLibraryStore.restoreSnapshot(app, "cloud", payload))
        val snapshot = ProfileLibraryStore.snapshot(app, "cloud")
        assertEquals(500, snapshot.watchlist.size)
        assertEquals(500, snapshot.hiddenCategories.size)
        assertEquals(ProfileLibraryStore.ALL_HOME_ROWS.take(2), snapshot.homeRows)
        assertEquals(256, (snapshot.settings["safe.key"] as String).length)
        assertEquals(true, snapshot.settings["enabled"])
        assertFalse(snapshot.settings.containsKey("unsafe key"))
    }

    @Test fun networkRestoreReappliesSettingsRemovalsAndHomeOrderEdits() {
        ProfileLibraryStore.setSetting(app, "removeMe", true, "race")
        val before = ProfileLibraryStore.snapshotJson(app, "race")
        val remote = JSONObject(before.toString()).apply {
            put("settings", JSONObject().put("removeMe", true).put("remote", 42))
        }
        ProfileLibraryStore.setSetting(app, "removeMe", null, "race")
        ProfileLibraryStore.setSetting(app, "newLocal", true, "race")
        val rows = ProfileLibraryStore.ALL_HOME_ROWS.reversed()
        ProfileLibraryStore.saveHomeRows(app, rows, "race")
        assertTrue(ProfileLibraryStore.restoreSnapshotPreservingEdits(app, "race", before, remote))
        assertEquals(mapOf("remote" to 42, "newLocal" to true), ProfileLibraryStore.settings(app, "race"))
        assertEquals(rows, ProfileLibraryStore.homeRows(app, "race"))
    }
}
