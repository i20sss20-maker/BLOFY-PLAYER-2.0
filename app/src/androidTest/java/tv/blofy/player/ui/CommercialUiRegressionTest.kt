package tv.blofy.player.ui

import android.content.Intent
import android.content.DialogInterface
import android.graphics.*
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.room.Room
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.CatalogSyncState
import tv.blofy.player.data.local.*
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.common.RootExitConfirmationDialog
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.settings.*
import java.io.File
import java.security.MessageDigest

/** Populated TV screens using an isolated database and clearly synthetic artwork. */
@RunWith(AndroidJUnit4::class)
class CommercialUiRegressionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val singleton = BlofyDatabase::class.java.getDeclaredField("instance").apply { isAccessible = true }
    private var previous: Any? = null
    private lateinit var db: BlofyDatabase
    private val id = "commercial-ui-${System.nanoTime()}"
    private val artwork = mutableListOf<File>()

    @Before fun seed() {
        Assume.assumeTrue(DeviceClass.isTv(context))
        previous = singleton.get(null)
        db = Room.inMemoryDatabaseBuilder(context, BlofyDatabase::class.java).build()
        runBlocking {
            db.dao().upsertProviderStored(ProviderEntity(id, "مكتبة العرض التجريبي", "https://example.test", "", "", providerType = "m3u"))
            for (kind in listOf("movie", "series")) {
                db.dao().upsertCategories(listOf(CategoryEntity("$id:$kind:category", id, "category", kind, "مغامرات")))
                db.dao().upsertStreams((1..18).map { index ->
                    val url = fixtureArtwork(index)
                    StreamEntity("$id:$kind:$index", id, "$index", "category", kind,
                        listOf("رحلة إلى المجهول", "خلف الأفق", "ليالي المدينة", "أثر المطر", "الطريق الأخير")[(index - 1) % 5],
                        icon = url, backdrop = url, year = "2026", rating = "8.4", genre = "مغامرات • دراما",
                        plot = "رحلة تجمع أصدقاء قدامى وتكشف حكايات لم تكتمل، بين البحر والمدينة. " + if (index == 2) "تفاصيل طويلة للمشاهدة. ".repeat(40) else "",
                        directSource = "https://example.test/sample.mp4", duration = "01:45:00")
                })
            }
        }
        CatalogSyncState.markCatalogCommitted(context, id)
        singleton.set(null, db)
    }

    @After fun cleanup() {
        if (!::db.isInitialized) return
        singleton.set(null, previous)
        db.close()
        CatalogSyncState.clear(context, id)
        artwork.forEach(File::delete)
    }

    @Test fun homeReturnsFromLowerShelvesToHeroAndExitChoiceIsClear() {
        ActivityScenario.launch<HomeActivity>(Intent(context, HomeActivity::class.java)).use { scenario ->
            awaitUi { scenario.onActivity { a -> assertNotNull(a.window.decorView.findViewWithTag<View>("$id:movie:1")) } }
            scenario.onActivity { a ->
                val shelf = descendants(a.window.decorView).filterIsInstance<HorizontalScrollView>().first { scroll ->
                    val row = scroll.getChildAt(0) as? ViewGroup
                    row != null && row.childCount > 5 && row.getChildAt(0).tag?.toString()?.startsWith(id) == true
                }
                val row = shelf.getChildAt(0) as ViewGroup
                val fullyVisible = (0 until row.childCount).map(row::getChildAt).count { card ->
                    val rect = Rect()
                    card.getGlobalVisibleRect(rect) && rect.width() >= card.width - 2
                }
                assertEquals("A TV shelf should expose five complete posters", 5, fullyVisible)
            }
            screenshot("home")
            scenario.onActivity { a ->
                val first = descendants(a.window.decorView).filterIsInstance<Button>().first { it.isShown }
                first.requestFocus()
            }
            repeat(5) { key(KeyEvent.KEYCODE_DPAD_DOWN) }
            scenario.onActivity { a ->
                val scroll = a.window.decorView.findViewWithTag<ScrollView>("blofy_home_feed_scroll")
                assertTrue("Down must reach lower shelves", scroll.scrollY > 0)
            }
            var reachedHero = false
            repeat(12) {
                if (!reachedHero) key(KeyEvent.KEYCODE_DPAD_UP)
                scenario.onActivity { reachedHero = it.window.decorView.findViewWithTag<View>("blofy_home_hero").hasFocus() }
            }
            awaitUi { scenario.onActivity { a ->
                val hero = a.window.decorView.findViewWithTag<ViewGroup>("blofy_home_hero")
                assertTrue("Up must return to the banner", hero.hasFocus())
                assertVisible(a.currentFocus!!)
            } }
            repeat(5) { key(KeyEvent.KEYCODE_DPAD_DOWN) }
            scenario.onActivity { a -> a.window.decorView.findViewWithTag<View>("side_home").performClick() }
            awaitUi { scenario.onActivity { a ->
                assertTrue(a.window.decorView.findViewWithTag<View>("blofy_home_hero").hasFocus())
                assertEquals(0, a.window.decorView.findViewWithTag<ScrollView>("blofy_home_feed_scroll").scrollY)
            } }
            key(KeyEvent.KEYCODE_BACK)
            awaitUi { scenario.onActivity { a ->
                val dialog = a.supportFragmentManager.fragments.filterIsInstance<RootExitConfirmationDialog>().single().dialog as AlertDialog
                assertTrue(dialog.getButton(DialogInterface.BUTTON_NEGATIVE).hasFocus())
                assertVisible(dialog.getButton(DialogInterface.BUTTON_NEGATIVE))
                assertVisible(dialog.getButton(DialogInterface.BUTTON_POSITIVE))
                assertEquals(Color.WHITE, (dialog.getButton(DialogInterface.BUTTON_NEGATIVE).background as android.graphics.drawable.GradientDrawable).color!!.defaultColor)
            } }
            screenshot("exit-stay")
            key(KeyEvent.KEYCODE_DPAD_LEFT)
            scenario.onActivity { a ->
                val dialog = a.supportFragmentManager.fragments.filterIsInstance<RootExitConfirmationDialog>().single().dialog as AlertDialog
                assertTrue(dialog.getButton(DialogInterface.BUTTON_POSITIVE).hasFocus())
            }
            screenshot("exit-yes")
            key(KeyEvent.KEYCODE_BACK)
            scenario.onActivity { a -> assertFalse(a.isFinishing) }
        }
    }

    @Test fun catalogHasFivePostersAndBothDetailsKeepActionsOnScreen() {
        for (kind in listOf("movie", "series")) {
            ActivityScenario.launch<PosterCatalogActivity>(Intent(context, PosterCatalogActivity::class.java).putExtra("kind", kind)).use { scenario ->
                awaitUi { scenario.onActivity { a ->
                    val grid = descendants(a.window.decorView).filterIsInstance<RecyclerView>().first { it.layoutManager is GridLayoutManager }
                    assertEquals(5, (grid.layoutManager as GridLayoutManager).spanCount)
                    assertTrue(grid.childCount >= 5)
                    for (i in 0..4) assertVisible(grid.getChildAt(i))
                    val search = field<View>(a, "searchBar")
                    assertFalse("Entry should select the category without a search jump", search.hasFocus())
                } }
                screenshot("catalog-$kind")
            }
            val type = if (kind == "movie") MovieDetailsActivity::class.java else SeriesDetailsActivity::class.java
            for (index in listOf(1, 2)) {
                ActivityScenario.launch<android.app.Activity>(Intent(context, type).putExtra("provider_id", id).putExtra("content_key", "$id:$kind:$index")).use { scenario ->
                    awaitUi { scenario.onActivity { a ->
                        val label = a.getString(if (kind == "movie") R.string.details_watch_now else R.string.details_seasons_episodes)
                        val play = descendants(a.window.decorView).filterIsInstance<Button>().firstOrNull { it.text.toString() == label }
                        assertNotNull(play)
                        assertVisible(play!!)
                    } }
                    screenshot("details-$kind-$index")
                }
            }
        }
    }

    @Test fun settingsAreGroupedReachableAndDoNotExposeDeveloperStatus() {
        ActivityScenario.launch<SettingsActivity>(Intent(context, SettingsActivity::class.java)).use { scenario ->
            awaitUi { scenario.onActivity { a ->
                val views = descendants(a.window.decorView)
                assertEquals(1, views.count { it.tag == "blofy_subscription_entry" })
                assertTrue(views.first { it.tag == "blofy_subscription_entry" }.parent is GridLayout)
                assertTrue(views.filterIsInstance<GridLayout>().count() >= 5)
            } }
            screenshot("settings-top")
            repeat(14) { key(KeyEvent.KEYCODE_DPAD_DOWN) }
            scenario.onActivity { a -> assertVisible(a.currentFocus!!) }
            screenshot("settings-bottom")
            repeat(14) { key(KeyEvent.KEYCODE_DPAD_UP) }
            scenario.onActivity { a -> assertVisible(a.currentFocus!!) }
        }
        for (type in listOf(CommercialSettingsActivity::class.java, SystemStatusActivity::class.java)) {
            ActivityScenario.launch<android.app.Activity>(Intent(context, type)).use { scenario ->
                SystemClock.sleep(900)
                scenario.onActivity { a ->
                    val text = descendants(a.window.decorView).filterIsInstance<TextView>().joinToString(" ") { it.text.toString() }
                    listOf("FFmpeg", "مدمج", "Safe Mode", "Feature Flags", "Rollout", "Config r", "البناء").forEach { assertFalse("Customer settings expose $it", text.contains(it)) }
                }
                screenshot(type.simpleName)
            }
        }
    }

    private fun fixtureArtwork(index: Int): String {
        val url = "https://example.test/$id/poster-$index.jpg"
        val bitmap = Bitmap.createBitmap(420, 630, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val hue = (index * 39f) % 360f
        paint.shader = LinearGradient(0f, 0f, 420f, 630f, Color.HSVToColor(floatArrayOf(hue, .55f, .6f)), Color.rgb(15, 10, 28), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, 420f, 630f, paint)
        paint.shader = null; paint.color = 0x33FFFFFF; canvas.drawCircle(330f, 180f, 170f, paint)
        paint.color = Color.WHITE; paint.textSize = 90f; canvas.drawText("$index", 35f, 500f, paint)
        paint.textSize = 25f; canvas.drawText("BLOFY / UI PREVIEW", 35f, 560f, paint)
        for (bucket in listOf(280, 420, 640)) {
            val hash = MessageDigest.getInstance("SHA-256").digest("$url@$bucket".toByteArray()).joinToString("") { "%02x".format(it) }
            val file = File(File(context.cacheDir, "blofy_posters").apply { mkdirs() }, "$hash.jpg")
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            artwork.add(file)
        }
        bitmap.recycle()
        return url
    }

    private fun key(code: Int) { instrumentation.sendKeyDownUpSync(code); SystemClock.sleep(180) }
    private fun screenshot(name: String) {
        instrumentation.waitForIdleSync()
        SystemClock.sleep(200)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val folder = File(context.getExternalFilesDir(null), "rc37-ui").apply { mkdirs() }
        File(folder, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun assertVisible(view: View) {
        val visible = Rect()
        assertTrue(view.getGlobalVisibleRect(visible))
        assertTrue("View clipped: $visible vs ${view.width}x${view.height}", visible.width() >= view.width - 3 && visible.height() >= view.height - 3)
    }
    private fun awaitUi(block: () -> Unit) {
        val end = SystemClock.uptimeMillis() + 12_000
        var failure: Throwable? = null
        while (SystemClock.uptimeMillis() < end) {
            try { instrumentation.waitForIdleSync(); block(); return } catch (t: AssertionError) { failure = t }
            SystemClock.sleep(180)
        }
        throw AssertionError("UI did not become ready", failure)
    }
    private fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()
    @Suppress("UNCHECKED_CAST") private fun <T> field(target: Any, name: String): T = target.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(target) as T
}
