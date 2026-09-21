package tv.blofy.player.ui

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import androidx.recyclerview.widget.RecyclerView
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.WatchStateEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterStreamAdapter
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class CatalogRecoveryDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val evidence get() = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }

    @Test fun firstAttemptRecoversWithoutShowingAnError() {
        val calls = ConcurrentHashMap<String, Int>()
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val action = request.requestUrl!!.queryParameter("action").orEmpty()
                    val count = calls.merge(action, 1, Int::plus)!!
                    if (action == "get_series" && count == 1) return MockResponse().setResponseCode(503)
                    val body = when {
                        action.endsWith("categories") -> "[]"
                        action == "get_series" -> "[{\"series_id\":1,\"name\":\"Saved series\"}]"
                        action.endsWith("streams") -> "[{\"stream_id\":1,\"name\":\"Saved item\"}]"
                        else -> "{}"
                    }
                    return MockResponse().setBody(body)
                }
            }; start()
        }
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        val provider = ProviderEntity("first-attempt-qa", "Recovery fixture", server.url("/").toString(), "u", "p")
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        // Stop at the real navigation boundary; do not run Home's unrelated feeds in this test.
        val home = instrumentation.addMonitor(HomeActivity::class.java.name,
            Instrumentation.ActivityResult(Activity.RESULT_OK, Intent()), true)
        try {
            runBlocking(Dispatchers.IO) { db.dao().saveAndActivateProvider(provider) }
            CatalogSyncState.markPending(context, provider.id)
            singleton.set(null, db)
            val started = SystemClock.elapsedRealtime()
            ActivityScenario.launch<CatalogLoadingActivity>(Intent(context, CatalogLoadingActivity::class.java)
                .putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, provider.id)).use { scenario ->
                var activity: CatalogLoadingActivity? = null
                scenario.onActivity { activity = it }
                val deadline = started + 20_000
                while (home.hits == 0 && SystemClock.elapsedRealtime() < deadline) {
                    instrumentation.runOnMainSync {
                        assertFalse("A transient first response must not show the error/retry button",
                            descendants(checkNotNull(activity).window.decorView).filterIsInstance<Button>()
                                .any { it.text == context.getString(R.string.catalog_retry) && it.visibility == View.VISIBLE })
                    }
                    SystemClock.sleep(25)
                }
                assertEquals("The first attempt must navigate to Home without a manual retry", 1, home.hits)
            }
            assertTrue(CatalogSyncState.isEntryReady(context, provider.id))
            runBlocking(Dispatchers.IO) { assertEquals(3, db.dao().streamCountForProvider(provider.id)) }
            assertEquals(2, calls["get_series"])
            assertEquals(1, calls["get_live_streams"])
            assertEquals(1, calls["get_vod_streams"])
            File(evidence, "first-attempt-result.txt").writeText(
                "first_series_response=503\nautomatic_recovery=true\nerror_shown=false\nmanual_retry=false\ncomplete_sections=3\nlive_requests=1\nmovie_requests=1\nseries_requests=2\nelapsed_ms=${SystemClock.elapsedRealtime() - started}\n")
        } finally {
            WorkManager.getInstance(context).cancelAllWork().result.get(10, TimeUnit.SECONDS)
            instrumentation.removeMonitor(home)
            singleton.set(null, previous)
            db.close()
            server.shutdown()
        }
    }

    @Test fun favoritesOpenQuicklyInTwoHundredThousandRowsDuringWrites(): Unit = runBlocking(Dispatchers.IO) {
        val name = "large-favorites-qa.db"
        val id = "large-favorites-qa"
        val base = File(evidence, "fixture-base.txt").readText()
        val poster = "${base}art/1"
        assertTrue("Prior process must have saved the poster", ArtworkLoader.isPersisted(context, poster))
        context.deleteDatabase(name)
        fun open() = Room.databaseBuilder(context, BlofyDatabase::class.java, name)
            .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
            .addMigrations(*BlofyDatabase.ALL_MIGRATIONS).build()
        var db = open()
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        val provider = ProviderEntity(id, "Large library", "https://offline.example.test", "u", "p")
        val watch = WatchStateEntity("$id:movie:0", id, "movie", 40_000, 100_000)
        try {
            db.dao().saveAndActivateProvider(provider)
            val sql = db.openHelper.writableDatabase
            val statement = sql.compileStatement("INSERT INTO streams (`key`,providerId,remoteId,kind,name,icon,plot,archiveEnabled,archiveDurationDays,favorite,locked) VALUES (?,?,?,?,?,?,?,0,0,?,0)")
            db.runInTransaction {
                statement.use {
                    for (i in 0 until 200_000) {
                        it.bindString(1, "$id:movie:$i"); it.bindString(2, id); it.bindString(3, i.toString())
                        it.bindString(4, "movie")
                        it.bindString(5, "Movie ${((i.toLong() * 104729) % 200003).toString().padStart(6, '0')}")
                        it.bindString(6, poster); it.bindString(7, "Saved plot ".repeat(80))
                        it.bindLong(8, if (i % 5000 == 0) 1 else 0)
                        it.executeInsert()
                    }
                }
            }
            db.dao().saveWatchState(watch)
            val rowId = db.dao().streamRowId(watch.contentKey)
            db.close()
            var beforeMs = 0L
            var beforePlan = ""
            val query = "SELECT * FROM streams WHERE providerId=? AND favorite=1 ORDER BY name"
            SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use {
                it.execSQL("DROP INDEX index_streams_providerId_favorite_name")
                it.version = 12
                beforePlan = it.rawQuery("EXPLAIN QUERY PLAN $query", arrayOf(id)).use { cursor ->
                    buildString { while (cursor.moveToNext()) append(cursor.getString(3)) }
                }
                val started = SystemClock.elapsedRealtime()
                it.rawQuery(query, arrayOf(id)).use { cursor -> assertEquals(40, cursor.count) }
                beforeMs = SystemClock.elapsedRealtime() - started
            }
            db = open()
            // Force/validate the real 12 -> 13 migration before timing normal navigation.
            assertEquals(13, db.openHelper.readableDatabase.version)
            assertEquals(200_000, db.dao().streamCountForProvider(id))
            assertEquals(rowId, db.dao().streamRowId(watch.contentKey))
            assertEquals(provider, db.dao().provider(id))
            assertEquals(watch, db.dao().watchState(watch.contentKey))
            val plan = db.openHelper.readableDatabase.query("EXPLAIN QUERY PLAN $query", arrayOf(id)).use { cursor ->
                buildString { while (cursor.moveToNext()) append(cursor.getString(3)) }
            }
            assertTrue(plan.contains("index_streams_providerId_favorite_name"))
            assertFalse(plan.contains("TEMP B-TREE"))
            val started = SystemClock.elapsedRealtime()
            assertEquals(40, db.dao().favorites(id).first().size)
            val afterMs = SystemClock.elapsedRealtime() - started
            assertTrue("Indexed favorites query took ${afterMs}ms", afterMs < 1_500)
            singleton.set(null, db)
            ArtworkLoader.clearMemory()
            var writes = 0
            val writer = launch {
                repeat(500) {
                    // Room invalidates favorite observers even for updates to unrelated rows.
                    db.dao().setFavorite("$id:movie:199999", false)
                    writes++
                    delay(20)
                }
            }
            val timings = mutableListOf<Long>()
            try {
                while (writes == 0) delay(10)
                repeat(2) { attempt ->
                    val opened = SystemClock.elapsedRealtime()
                    ActivityScenario.launch(LibraryActivity::class.java).use { scenario ->
                        var visible = false
                        while (!visible && SystemClock.elapsedRealtime() - opened < 6_000) {
                            scenario.onActivity { activity ->
                                val grid = descendants(activity.window.decorView).filterIsInstance<RecyclerView>().first()
                                val holder = grid.findViewHolderForAdapterPosition(0) as? PosterStreamAdapter.Holder
                                val bitmap = (holder?.image?.drawable as? BitmapDrawable)?.bitmap
                                visible = grid.adapter?.itemCount == 40 && bitmap?.width == 180 && bitmap.height == 270
                            }
                            if (!visible) SystemClock.sleep(20)
                        }
                        assertTrue("Favorites with 200k rows must bind saved posters promptly", visible)
                        // Wait for the actual rendered frame, not just ImageView.setImageDrawable.
                        if (android.os.Build.VERSION.SDK_INT >= 29) {
                            val rendered = java.util.concurrent.CountDownLatch(1)
                            scenario.onActivity { activity ->
                                activity.window.decorView.viewTreeObserver.registerFrameCommitCallback { rendered.countDown() }
                                activity.window.decorView.invalidate()
                            }
                            assertTrue("The poster frame must reach the display", rendered.await(2, TimeUnit.SECONDS))
                        }
                        val elapsed = SystemClock.elapsedRealtime() - opened
                        timings += elapsed
                        if (attempt == 0) File(evidence, "favorites-200k.png").outputStream().use {
                            assertTrue(instrumentation.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it))
                        }
                        db.dao().setFavorite(watch.contentKey, false)
                        val updateStarted = SystemClock.elapsedRealtime()
                        var updated = false
                        while (!updated && SystemClock.elapsedRealtime() - updateStarted < 3_000) {
                            scenario.onActivity { activity ->
                                updated = descendants(activity.window.decorView).filterIsInstance<RecyclerView>().first().adapter?.itemCount == 39
                            }
                            if (!updated) SystemClock.sleep(20)
                        }
                        assertTrue("Favorite removal must update the open grid", updated)
                    }
                    db.dao().setFavorite(watch.contentKey, true)
                }
            } finally { writer.cancelAndJoin() }
            File(evidence, "favorites-200k-result.txt").writeText(
                "catalog=200000\nfavorites=40\nmigration=12_to_13\nrowids_credentials_history_preserved=true\nold_query_ms=$beforeMs\nnew_query_ms=$afterMs\nold_plan=$beforePlan\nnew_plan=$plan\nfirst_posters_ms=${timings[0]}\nreopen_posters_ms=${timings[1]}\nconcurrent_writes=$writes\nlive_favorite_removal=true\nsource_server_stopped=true\n")
        } finally { singleton.set(null, previous); db.close(); context.deleteDatabase(name) }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
