package tv.blofy.player.data

import android.app.Application
import android.database.sqlite.SQLiteDiskIOException
import android.database.sqlite.SQLiteFullException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class CatalogImportFailureTest {
    @Test fun detectsDirectAndWrappedStorageFailures() {
        assertTrue(CatalogImportFailure.isStorageFailure(SQLiteFullException("full")))
        assertTrue(CatalogImportFailure.isStorageFailure(IllegalStateException("wrapper", SQLiteFullException("full"))))
        assertTrue(CatalogImportFailure.isStorageFailure(SQLiteDiskIOException("disk IO")))
    }
    @Test fun networkAndProviderMessagesAreNotMistakenForStorageFailures() {
        assertFalse(CatalogImportFailure.isStorageFailure(IOException("offline")))
        assertFalse(CatalogImportFailure.isStorageFailure(IOException("database or disk is full")))
        assertFalse(CatalogImportFailure.isStorageFailure(IllegalStateException("source changed")))
        assertFalse(CatalogImportFailure.isStorageFailure(CancellationException("left")))
    }
    @Test fun onlyOrdinaryRefreshMayReopenPreviousAccount() {
        val network = IOException("offline")
        for (first in listOf(false, true)) for (replacing in listOf(false, true)) {
            assertEquals(!first && !replacing, CatalogImportFailure.canReopenPrevious(first, replacing, network))
            assertFalse(CatalogImportFailure.canReopenPrevious(first, replacing, SQLiteFullException("full")))
        }
    }
    @Test fun successfulCleanupKeepsOriginalFailure(): Unit = runBlocking(Dispatchers.IO) {
        val original = IOException("offline")
        var cleaned = false
        CatalogImportFailure.cleanupPreserving(original) { cleaned = true }
        assertTrue(cleaned)
        assertTrue(original.suppressed.isEmpty())
    }
    @Test fun cancellationIsNotReplacedByCleanupFailure(): Unit = runBlocking(Dispatchers.IO) {
        val cancelled = CancellationException("user left")
        val secondary = SQLiteFullException("cleanup failed")
        CatalogImportFailure.cleanupPreserving(cancelled) { throw secondary }
        assertSame(secondary, cancelled.suppressed.single())
    }
    @Test fun sameExceptionIsNeverAddedToItself(): Unit = runBlocking(Dispatchers.IO) {
        val original = SQLiteFullException("full")
        CatalogImportFailure.cleanupPreserving(original) { throw original }
        assertTrue(original.suppressed.isEmpty())
    }
}
