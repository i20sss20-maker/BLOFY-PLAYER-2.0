package tv.blofy.player.ui

import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.core.identity.ActivationManager
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.FirstImportCheckpoint
import tv.blofy.player.data.local.*
import tv.blofy.player.data.preparation.CatalogLoadPersistence
import tv.blofy.player.ui.login.LoginActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Isolated databases and fixture accounts only; never deletes or updates a user's library. */
@RunWith(AndroidJUnit4::class)
class CatalogRecoveryRegressionTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun provider() = ProviderEntity("recovery-${System.nanoTime()}", "Saved recovery fixture", "https://example.test", "", "")
    private fun stream(p: ProviderEntity, kind: String) = StreamEntity("${p.id}:$kind:1", p.id, "1", null, kind, "Saved $kind")

    @Test fun completedSectionsSurviveInterruptedFirstImportButNeverGrantEntry() = runBlocking(Dispatchers.IO) {
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        val p = provider()
        try {
            val dao = db.dao()
            dao.upsertProviderStored(p)
            val first = CatalogLoadPersistence(context, dao, p, p.id, true)
            first.prepareFirstImport()
            for (kind in listOf("live", "movie")) {
                dao.upsertStreams(listOf(stream(p, kind)))
                first.sectionCompleted(kind)
            }
            dao.upsertStreams(listOf(stream(p, "series"))) // Interrupted response, no completion marker.
            first.discardIfUncommitted()
            assertEquals(2, dao.streamCountForProvider(p.id))
            assertFalse(CatalogLoadPersistence.hasCommittedCatalog(context, dao, p.id))
            val retry = CatalogLoadPersistence(context, dao, p, p.id, true)
            retry.prepareFirstImport()
            assertEquals(setOf("live", "movie"), retry.completedSections)
            assertEquals(0, dao.catalogCountAll(p.id, "series"))
            dao.upsertStreams(listOf(stream(p, "series")))
            retry.sectionCompleted("series")
            retry.commit { dao.activateImportedProvider(p) }
            assertTrue(CatalogLoadPersistence.hasCommittedCatalog(context, dao, p.id))
            assertEquals(3, dao.streamCountForProvider(p.id))
        } finally {
            db.close(); CatalogSyncState.clear(context, p.id); FirstImportCheckpoint.clear(context, p.id)
        }
    }

    @Test fun savedPlaylistReadDoesNotWaitForCatalogWriter() = runBlocking(Dispatchers.IO) {
        val name = "recovery-wal-${System.nanoTime()}.db"
        val db = Room.databaseBuilder(context, BlofyDatabase::class.java, name)
            .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING).build()
        val release = CompletableDeferred<Unit>()
        try {
            val p = provider(); db.dao().upsertProviderStored(p)
            val started = CompletableDeferred<Unit>()
            val writer = launch {
                db.withTransaction {
                    db.dao().upsertStreams(listOf(stream(p, "series")))
                    started.complete(Unit)
                    release.await()
                }
            }
            started.await()
            val cards = withTimeout(2_000) { db.dao().providerSnapshotStored() }
            assertEquals(listOf(p), cards)
            release.complete(Unit); writer.join()
        } finally { release.complete(Unit); db.close(); context.deleteDatabase(name) }
    }

    @Test fun blockedLocalReadReplacesLoadingWithRetryAndRecoversWithoutClearingData() {
        val executor = Executors.newSingleThreadExecutor()
        val release = CountDownLatch(1)
        val blocked = CountDownLatch(1)
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).setQueryExecutor(executor).build()
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        val p = provider()
        var scenario: ActivityScenario<LoginActivity>? = null
        try {
            runBlocking(Dispatchers.IO) { db.dao().upsertProviderStored(p); ActivationManager(context, db.dao()).ensureIdentity() }
            executor.execute { blocked.countDown(); release.await(20, TimeUnit.SECONDS) }
            assertTrue(blocked.await(2, TimeUnit.SECONDS))
            singleton.set(null, db)
            scenario = ActivityScenario.launch(Intent(context, LoginActivity::class.java))
            SystemClock.sleep(8_600)
            scenario.onActivity { activity ->
                val texts = descendants(activity.window.decorView).filterIsInstance<TextView>().map { it.text.toString() }.toList()
                assertFalse("Loading must have an independent UI deadline", activity.getString(R.string.login_loading_saved_playlists) in texts)
                assertTrue(activity.getString(R.string.login_saved_playlists_failed) in texts)
            }
            release.countDown()
            SystemClock.sleep(500)
            scenario.onActivity { activity ->
                descendants(activity.window.decorView).filterIsInstance<Button>()
                    .first { it.text == activity.getString(R.string.catalog_retry) }.performClick()
            }
            val deadline = SystemClock.elapsedRealtime() + 3_000
            var found = false
            while (!found && SystemClock.elapsedRealtime() < deadline) {
                scenario.onActivity { found = it.window.decorView.findViewWithTag<View>(p.id) != null }
                if (!found) SystemClock.sleep(50)
            }
            assertTrue("Retry must recover saved cards", found)
            assertEquals(p, runBlocking(Dispatchers.IO) { db.dao().providerStored(p.id) })
        } finally {
            release.countDown(); scenario?.close(); singleton.set(null, previous); db.close(); executor.shutdownNow()
        }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(descendants(view.getChildAt(index)))
    }
}
