package tv.blofy.player.data

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class LocalStorageManagerTest {
    private lateinit var root: File
    private lateinit var context: Context
    @Before fun setup() {
        root = Files.createTempDirectory("blofy-storage-test").toFile()
        context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getApplicationContext(): Context = this
            override fun getFilesDir() = File(root, "files")
            override fun getCacheDir() = File(root, "cache")
            override fun getExternalCacheDir() = File(root, "external-cache")
            override fun getDatabasePath(name: String) = File(File(root, "databases"), name)
        }
    }
    @After fun cleanup() { root.deleteRecursively() }
    private fun bytes(path: String, count: Int) { File(root, path).apply { parentFile.mkdirs(); writeBytes(ByteArray(count)) } }

    @Test fun countsAllDatabasesPinnedArtworkAndPreferencesExactlyOnce() {
        bytes("databases/blofy-player-2.db", 11)
        bytes("databases/blofy-player-2.db-wal", 13)
        bytes("databases/blofy-provider-metadata.db", 17)
        bytes("databases/blofy-preparation-v1.db", 19)
        bytes("files/blofy_library_art/ab/poster.jpg", 23)
        bytes("files/other.json", 29)
        bytes("shared_prefs/catalog.xml", 31)
        bytes("cache/image.jpg", 37)
        bytes("external-cache/temp", 41)
        val stats = LocalStorageManager.stats(context)
        assertEquals(60L, stats.databaseBytes)
        assertEquals(23L, stats.artworkBytes)
        assertEquals(60L, stats.otherPersistentBytes)
        assertEquals(78L, stats.temporaryBytes)
        assertEquals(221L, stats.totalBytes)
    }
    @Test fun noDirectoriesIsAValidZeroFootprint() {
        assertEquals(0L, LocalStorageManager.stats(context).totalBytes)
    }
    @Test fun countingDoesNotDeleteOrModifyPersistentImages() {
        bytes("files/blofy_library_art/one.jpg", 87)
        repeat(3) { assertEquals(87L, LocalStorageManager.stats(context).artworkBytes) }
        assertEquals(87L, File(root, "files/blofy_library_art/one.jpg").length())
    }
}
