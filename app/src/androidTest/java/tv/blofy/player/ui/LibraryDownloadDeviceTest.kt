package tv.blofy.player.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.preparation.FullLibrarySyncWorker
import tv.blofy.player.data.preparation.PreparationJournal
import tv.blofy.player.ui.settings.LibraryDownloadActivity
import java.io.File
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LibraryDownloadDeviceTest {
    @Test fun statusShowsSavedMissingAndFailedWithoutStartingAProviderRefresh() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
        val previous = singleton.get(null)
        val provider = ProviderEntity("download-status-qa", "باقة الاختبار", "http://127.0.0.1:9", "u", "p")
        val manager = WorkManager.getInstance(context)
        val oldLocales = AppCompatDelegate.getApplicationLocales()
        try {
            manager.cancelAllWork().result.get(10, TimeUnit.SECONDS)
            runBlocking(Dispatchers.IO) { db.dao().saveAndActivateProvider(provider) }
            singleton.set(null, db)
            CatalogSyncState.markCatalogCommitted(context, provider.id)
            val epoch = CatalogSyncState.lastUpdatedAt(context, provider.id)
            PreparationJournal(context).use { journal ->
                journal.begin(provider.id, "status-fixture", epoch)
                journal.enqueue(provider.id, "art", "missing", "http://127.0.0.1:9/missing")
                journal.enqueue(provider.id, "detail", "detail")
                journal.finishBatch(provider.id, "art", emptyList(), listOf("missing"))
            }
            instrumentation.runOnMainSync { AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("ar")) }
            ActivityScenario.launch<LibraryDownloadActivity>(Intent(context, LibraryDownloadActivity::class.java)).use { scenario ->
                var rendered = false
                val deadline = SystemClock.elapsedRealtime() + 10_000
                while (!rendered && SystemClock.elapsedRealtime() < deadline) {
                    scenario.onActivity { activity ->
                        val root = activity.window.decorView
                        val failed = root.findViewWithTag<TextView>("library_download_failed").text.toString()
                        if (failed.contains("1")) {
                            assertTrue(root.findViewWithTag<TextView>("library_download_saved").text.isNotBlank())
                            assertTrue(root.findViewWithTag<TextView>("library_download_pending").text.toString().contains("1"))
                            assertTrue(root.findViewWithTag<Button>("library_download_resume").isEnabled)
                            rendered = true
                        }
                    }
                    if (!rendered) SystemClock.sleep(25)
                }
                assertTrue("Local download counts must render", rendered)
                assertTrue("Viewing status must not enqueue downloads", manager
                    .getWorkInfosForUniqueWork(FullLibrarySyncWorker.workName(provider.id)).get(10, TimeUnit.SECONDS).isEmpty())
                val evidence = File(context.getExternalFilesDir(null), "artwork-qa").apply { mkdirs() }
                instrumentation.uiAutomation.takeScreenshot().let { bitmap ->
                    File(evidence, "library-download-status.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    bitmap.recycle()
                }
                File(evidence, "library-download-status.txt").writeText("pending_images=1\npending_details=1\nfailed=1\nresume_enabled=true\nopening_started_no_work=true\n")
            }
        } finally {
            instrumentation.runOnMainSync { AppCompatDelegate.setApplicationLocales(oldLocales) }
            singleton.set(null, previous)
            db.close()
        }
    }
}
