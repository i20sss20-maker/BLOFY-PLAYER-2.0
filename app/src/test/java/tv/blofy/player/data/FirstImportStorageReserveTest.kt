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
class FirstImportStorageReserveTest {
    private lateinit var root: File
    private lateinit var context: Context
    private var free = 0L
    @Before fun setup() {
        root = Files.createTempDirectory("blofy-first-import-space").toFile()
        context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getApplicationContext(): Context = this
            override fun getFilesDir(): File = object : File(root, "files") {
                override fun getUsableSpace() = free
            }
            override fun getCacheDir() = File(root, "cache")
            override fun getExternalCacheDir() = File(root, "external-cache")
        }
        File(root, "files/blofy_library_art/saved.jpg").apply { parentFile.mkdirs(); writeText("saved artwork") }
        File(root, "databases/blofy-player-2.db").apply { parentFile.mkdirs(); writeText("old-account-fixture") }
    }
    @After fun cleanup() { root.deleteRecursively() }
    @Test fun lowInternalReserveRejectsImportWithoutDeletingSavedLibrary() {
        free = 1024L
        assertFalse(LocalStorageManager.prepareForFirstImport(context))
        assertEquals("saved artwork", File(root, "files/blofy_library_art/saved.jpg").readText())
        assertEquals("old-account-fixture", File(root, "databases/blofy-player-2.db").readText())
    }
    @Test fun adequateInternalSpaceDoesNotBlockASecondAccount() {
        free = 2L * 1024 * 1024 * 1024
        assertTrue(LocalStorageManager.prepareForFirstImport(context))
        assertTrue(File(root, "files/blofy_library_art/saved.jpg").exists())
        assertTrue(File(root, "databases/blofy-player-2.db").exists())
    }
}
