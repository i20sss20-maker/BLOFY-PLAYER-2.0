package tv.blofy.player.ui.catalog

import android.app.Application
import android.content.ComponentCallbacks2
import android.graphics.Bitmap
import android.util.LruCache
import android.widget.ImageView
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.blofy.player.BlofyApp

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ArtworkMemoryPressureTest {
    @Suppress("UNCHECKED_CAST")
    private fun <T> cacheField(name: String): LruCache<String, T> =
        ArtworkLoader::class.java.getDeclaredField(name).apply { isAccessible = true }
            .get(ArtworkLoader) as LruCache<String, T>

    private val bitmaps get() = cacheField<Bitmap>("cache")
    private val failures get() = cacheField<Long>("failedUntil")

    @Before fun reset() = ArtworkLoader.clearMemory()
    @After fun cleanup() = ArtworkLoader.clearMemory()

    private fun fill(): Bitmap {
        val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        repeat(8) { bitmaps.put("poster-$it", bitmap) }
        repeat(8) { failures.put("missing-$it", Long.MAX_VALUE) }
        return bitmap
    }

    @Test fun applicationLowMemoryReleasesArtworkWithoutRecyclingVisibleBitmap() {
        val bitmap = fill()
        val view = ImageView(RuntimeEnvironment.getApplication()).apply { setImageBitmap(bitmap) }
        BlofyApp().onLowMemory()
        assertEquals(0, bitmaps.size())
        assertEquals(0, failures.size())
        assertFalse(bitmap.isRecycled)
        assertNotNull(view.drawable)
    }

    @Test fun criticalPressureReleasesBothCaches() {
        fill()
        BlofyApp().onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL)
        assertEquals(0, bitmaps.size())
        assertEquals(0, failures.size())
    }

    @Test fun lowPressureTrimsAndUiHiddenReleasesRemainingEntries() {
        fill()
        val previous = bitmaps.size()
        BlofyApp().onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)
        assertTrue(bitmaps.size() in 1 until previous)
        assertEquals(4, failures.size())
        BlofyApp().onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN)
        assertEquals(0, bitmaps.size())
        assertEquals(0, failures.size())
    }

    @Test fun failedArtworkUrlsStayBoundedAcrossHugeBrokenCatalogs() {
        repeat(10_000) { failures.put("unavailable-$it", Long.MAX_VALUE) }
        assertTrue(failures.size() <= 2_048)
        assertNull(failures.get("unavailable-0"))
        assertEquals(Long.MAX_VALUE, failures.get("unavailable-9999"))
    }
}
