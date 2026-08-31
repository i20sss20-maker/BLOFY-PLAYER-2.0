package tv.blofy.player

import android.content.Intent
import android.graphics.Bitmap
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.CatalogLoadingActivity
import tv.blofy.player.ui.login.LoginActivity
import tv.blofy.player.ui.settings.SettingsActivity
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class DesignSnapshotTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val providerId = "design-provider"
    private val movieKey = "$providerId:movie:101"
    private val seriesKey = "$providerId:series:201"

    @Before
    fun seedDesignCatalog() = runBlocking {
        val dao = BlofyDatabase.get(context).dao()
        dao.saveAndActivateProvider(
            ProviderEntity(
                id = providerId,
                name = "BLOFY Design Server",
                baseUrl = "https://10.255.255.1",
                username = "design",
                password = "design",
                enabled = true
            )
        )
        dao.upsertCategories(
            listOf(
                CategoryEntity("$providerId:live:1", providerId, "1", "live", "القنوات السعودية", 0),
                CategoryEntity("$providerId:live:2", providerId, "2", "live", "الرياضة", 1),
                CategoryEntity("$providerId:movie:10", providerId, "10", "movie", "أحدث الأفلام", 0),
                CategoryEntity("$providerId:movie:11", providerId, "11", "movie", "عربي", 1),
                CategoryEntity("$providerId:series:20", providerId, "20", "series", "أحدث المسلسلات", 0),
                CategoryEntity("$providerId:series:21", providerId, "21", "series", "دراما", 1)
            )
        )
        dao.upsertStreams(
            listOf(
                StreamEntity("$providerId:live:1", providerId, "1", "1", "live", "SSC 1"),
                StreamEntity("$providerId:live:2", providerId, "2", "1", "live", "MBC 1"),
                StreamEntity("$providerId:live:3", providerId, "3", "1", "live", "العربية"),
                StreamEntity("$providerId:live:4", providerId, "4", "2", "live", "beIN SPORTS 1"),
                StreamEntity(movieKey, providerId, "101", "10", "movie", "الفيلم الأول", plot = "فيلم تجريبي لعرض التصميم الحقيقي داخل المحاكي.", genre = "أكشن • دراما", year = "2026", rating = "8.7", duration = "02:08:00"),
                StreamEntity("$providerId:movie:102", providerId, "102", "10", "movie", "الفيلم الثاني", genre = "دراما", year = "2026", rating = "8.2"),
                StreamEntity("$providerId:movie:103", providerId, "103", "10", "movie", "الفيلم الثالث", genre = "خيال", year = "2025", rating = "7.9"),
                StreamEntity("$providerId:movie:104", providerId, "104", "11", "movie", "فيلم عربي", genre = "عربي", year = "2026", rating = "8.1"),
                StreamEntity(seriesKey, providerId, "201", "20", "series", "المسلسل الأول", plot = "مسلسل تجريبي لعرض المواسم والحلقات.", genre = "دراما", year = "2026", rating = "9.0"),
                StreamEntity("$providerId:series:202", providerId, "202", "20", "series", "المسلسل الثاني", genre = "أكشن", year = "2026", rating = "8.5"),
                StreamEntity("$providerId:series:203", providerId, "203", "21", "series", "المسلسل الثالث", genre = "دراما", year = "2025", rating = "8.0")
            )
        )
        dao.upsertEpisodes(
            listOf(
                EpisodeEntity("$providerId:episode:301", providerId, "201", "301", 1, 1, "الحلقة 1"),
                EpisodeEntity("$providerId:episode:302", providerId, "201", "302", 1, 2, "الحلقة 2"),
                EpisodeEntity("$providerId:episode:303", providerId, "201", "303", 1, 3, "الحلقة 3"),
                EpisodeEntity("$providerId:episode:304", providerId, "201", "304", 2, 1, "الحلقة 1")
            )
        )
    }

    @Test
    fun captureApprovedTvDesign() {
        capture("01-login") { ActivityScenario.launch(LoginActivity::class.java) }
        capture("02-loading") {
            ActivityScenario.launch<CatalogLoadingActivity>(
                Intent(context, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId)
            )
        }
        capture("03-home") { ActivityScenario.launch(HomeActivity::class.java) }
        capture("04-live") {
            ActivityScenario.launch<ContentBrowserActivity>(
                Intent(context, ContentBrowserActivity::class.java).putExtra("kind", "live")
            )
        }
        capture("05-movies") {
            ActivityScenario.launch<PosterCatalogActivity>(
                Intent(context, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, PosterCatalogActivity.KIND_MOVIE)
            )
        }
        capture("06-series") {
            ActivityScenario.launch<PosterCatalogActivity>(
                Intent(context, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, PosterCatalogActivity.KIND_SERIES)
            )
        }
        capture("07-movie-details") {
            ActivityScenario.launch<MovieDetailsActivity>(
                Intent(context, MovieDetailsActivity::class.java)
                    .putExtra("provider_id", providerId)
                    .putExtra("content_key", movieKey)
            )
        }
        capture("08-series-details") {
            ActivityScenario.launch<SeriesDetailsActivity>(
                Intent(context, SeriesDetailsActivity::class.java)
                    .putExtra("provider_id", providerId)
                    .putExtra("content_key", seriesKey)
            )
        }
        capture("09-settings") { ActivityScenario.launch(SettingsActivity::class.java) }
    }

    private fun <T : android.app.Activity> capture(
        name: String,
        launch: () -> ActivityScenario<T>
    ) {
        launch().use {
            instrumentation.waitForIdleSync()
            Thread.sleep(900)
            val bitmap = instrumentation.uiAutomation.takeScreenshot()
            val dir = File(context.getExternalFilesDir(null), "design-snapshots").apply { mkdirs() }
            FileOutputStream(File(dir, "$name.png")).use { out ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out))
            }
            bitmap.recycle()
        }
    }
}
