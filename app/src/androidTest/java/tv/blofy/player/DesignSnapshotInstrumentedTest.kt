package tv.blofy.player

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.test.core.app.ActivityScenario
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
import tv.blofy.player.data.local.WatchStateEntity
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
class DesignSnapshotInstrumentedTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context: Context get() = instrumentation.targetContext
    private val providerId = "design-snapshot-provider"
    private val movieKey = "$providerId:movie:101"
    private val seriesKey = "$providerId:series:201"

    @Before
    fun seedDesignCatalog() = runBlocking {
        val dao = BlofyDatabase.get(context).dao()
        val now = System.currentTimeMillis()
        val provider = ProviderEntity(
            id = providerId,
            name = "BLOFY Demo",
            baseUrl = "https://demo.invalid",
            username = "demo",
            password = "demo",
            enabled = true,
            updatedAt = now
        )
        dao.upsertProvider(provider)
        dao.disableAllProviders()
        dao.activateProvider(providerId, now)

        dao.upsertCategories(
            listOf(
                CategoryEntity("$providerId:live:1", providerId, "1", "live", "القنوات السعودية", 0),
                CategoryEntity("$providerId:live:2", providerId, "2", "live", "الرياضة", 1),
                CategoryEntity("$providerId:movie:10", providerId, "10", "movie", "أحدث الأفلام", 0),
                CategoryEntity("$providerId:movie:11", providerId, "11", "movie", "أفلام عربية", 1),
                CategoryEntity("$providerId:series:20", providerId, "20", "series", "أحدث المسلسلات", 0),
                CategoryEntity("$providerId:series:21", providerId, "21", "series", "مسلسلات عربية", 1)
            )
        )

        val streams = mutableListOf<StreamEntity>()
        repeat(10) { index ->
            val id = (index + 1).toString()
            streams += StreamEntity(
                key = "$providerId:live:$id",
                providerId = providerId,
                remoteId = id,
                categoryId = if (index < 6) "1" else "2",
                kind = "live",
                name = if (index == 0) "السعودية الأولى" else "قناة BLOFY ${index + 1}",
                streamType = "live"
            )
        }
        repeat(15) { index ->
            val id = (101 + index).toString()
            streams += StreamEntity(
                key = "$providerId:movie:$id",
                providerId = providerId,
                remoteId = id,
                categoryId = if (index < 9) "10" else "11",
                kind = "movie",
                name = if (index == 0) "ليلة في الرياض" else "فيلم BLOFY ${index + 1}",
                extension = "mp4",
                plot = "قصة سينمائية مختارة لعرض جودة واجهة BLOFY PLAYER على التلفزيون.",
                genre = if (index % 2 == 0) "دراما" else "أكشن",
                year = "2026",
                rating = if (index == 0) "8.7" else "7.${index % 9}",
                duration = "1:52:00",
                addedAt = now - index * 86_400_000L
            )
        }
        repeat(15) { index ->
            val id = (201 + index).toString()
            streams += StreamEntity(
                key = "$providerId:series:$id",
                providerId = providerId,
                remoteId = id,
                categoryId = if (index < 9) "20" else "21",
                kind = "series",
                name = if (index == 0) "حكاية BLOFY" else "مسلسل BLOFY ${index + 1}",
                plot = "مسلسل تجريبي لعرض تنسيق المواسم والحلقات والاستئناف.",
                genre = "دراما",
                year = "2026",
                rating = "9.1",
                addedAt = now - index * 86_400_000L
            )
        }
        dao.upsertStreams(streams)

        val episodes = (1..8).map { episode ->
            EpisodeEntity(
                key = "$providerId:episode:201-$episode",
                providerId = providerId,
                seriesId = "201",
                remoteId = "201-$episode",
                season = if (episode <= 4) 1 else 2,
                episode = if (episode <= 4) episode else episode - 4,
                title = "الحلقة ${if (episode <= 4) episode else episode - 4}",
                durationSecs = 2_700L
            )
        }
        dao.upsertEpisodes(episodes)
        dao.saveWatchState(
            WatchStateEntity(
                contentKey = movieKey,
                providerId = providerId,
                kind = "movie",
                positionMs = 2_100_000L,
                durationMs = 6_720_000L,
                updatedAt = now
            )
        )
        dao.saveWatchState(
            WatchStateEntity(
                contentKey = "$providerId:episode:201-2",
                providerId = providerId,
                kind = "episode",
                positionMs = 1_020_000L,
                durationMs = 2_700_000L,
                updatedAt = now
            )
        )
    }

    @Test
    fun captureApprovedTvScreens() {
        capture("01-login", Intent(context, LoginActivity::class.java), 900)
        capture("02-loading", Intent(context, CatalogLoadingActivity::class.java).putExtra(CatalogLoadingActivity.EXTRA_PROVIDER_ID, providerId), 250)
        capture("03-home", Intent(context, HomeActivity::class.java), 700)
        capture("04-live", Intent(context, ContentBrowserActivity::class.java).putExtra("kind", "live"), 350)
        capture("05-movies", Intent(context, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, PosterCatalogActivity.KIND_MOVIE), 700)
        capture("06-series", Intent(context, PosterCatalogActivity::class.java).putExtra(PosterCatalogActivity.EXTRA_KIND, PosterCatalogActivity.KIND_SERIES), 700)
        capture("07-movie-details", Intent(context, MovieDetailsActivity::class.java).putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId).putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, movieKey), 700)
        capture("08-series-details", Intent(context, SeriesDetailsActivity::class.java).putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId).putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, seriesKey), 700)
        capture("09-settings", Intent(context, SettingsActivity::class.java), 600)
    }

    private fun capture(name: String, intent: Intent, settleMs: Long) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<android.app.Activity>(intent).use {
            instrumentation.waitForIdleSync()
            Thread.sleep(settleMs)
            instrumentation.waitForIdleSync()
            val bitmap = instrumentation.uiAutomation.takeScreenshot()
                ?: error("Unable to capture $name")
            save(name, bitmap)
        }
    }

    private fun save(name: String, bitmap: Bitmap) {
        val root = File(context.getExternalFilesDir(null), "design-snapshots").apply { mkdirs() }
        FileOutputStream(File(root, "$name.png")).use { out ->
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out))
        }
    }
}
