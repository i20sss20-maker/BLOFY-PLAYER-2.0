package tv.blofy.player.core.security

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowAlertDialog
import tv.blofy.player.R
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.data.local.*
import tv.blofy.player.data.preparation.DatabaseIsolationRule
import tv.blofy.player.ui.catchup.CatchupActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.player.PlayerLifecycleTest
import tv.blofy.player.ui.series.EpisodesActivity
import java.util.concurrent.locks.LockSupport

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = InMemoryKeystoreApplication::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ContentAccessGateTest {
    @get:Rule internal val isolation = DatabaseIsolationRule()
    private val app get() = RuntimeEnvironment.getApplication()
    private val dao get() = BlofyDatabase.get(app).dao()
    private val controllers = mutableListOf<ActivityController<out AppCompatActivity>>()
    private val movie = stream("movie", "1")
    private val series = stream("series", "42.000")
    private val live = stream("live", "3")
    private val episode = EpisodeEntity("p:episode:7", "p", "42", "7", 1, 1, "Episode one")

    class Probe : ContentAccessActivity() {
        var loaded = false
        override fun onCreate(savedInstanceState: Bundle?) { setTheme(R.style.Theme_Blofy); super.onCreate(savedInstanceState) }
        override fun onContentReady(savedInstanceState: Bundle?) { loaded = true }
        fun transfer(intent: Intent) { contentAccess.forwardTo(intent) }
        fun switch(key: String, action: () -> Unit) { contentAccess.requireAccess("p", key, onGranted = action) }
    }

    private fun stream(kind: String, id: String, provider: String = "p") =
        StreamEntity("$provider:$kind:$id", provider, id, null, kind, "Safe title", locked = true)
    private fun intent(type: Class<*>, key: String = movie.key, provider: String = "p") =
        Intent(app, type).putExtra("provider_id", provider).putExtra("content_key", key)
            .putExtra("kind", "episode").putExtra("url", "https://example.test/1.mp4")
    private fun <T : AppCompatActivity> open(type: Class<T>, source: Intent = intent(type)): T =
        Robolectric.buildActivity(type, source).also { controllers += it }.setup().get()
    private fun idle() { shadowOf(Looper.getMainLooper()).idle() }
    private fun await(check: () -> Boolean) {
        val end = System.nanoTime() + 5_000_000_000L
        while (!check() && System.nanoTime() < end) { idle(); LockSupport.parkNanos(2_000_000L) }
        idle(); assertTrue("Timed out waiting for content access result", check())
    }
    private fun prompt(): AlertDialog {
        await { ShadowAlertDialog.getLatestAlertDialog()?.isShowing == true }
        return ShadowAlertDialog.getLatestAlertDialog()
    }
    private fun views(v: View): List<View> = listOf(v) + if (v is ViewGroup)
        (0 until v.childCount).flatMap { views(v.getChildAt(it)) } else emptyList()
    private fun answer(pin: String) {
        val dialog = prompt()
        views(dialog.window!!.decorView).filterIsInstance<EditText>().single().setText(pin)
        idle(); dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); idle()
    }

    @Before fun seed(): Unit = runBlocking(Dispatchers.IO) {
        listOf("blofy_parental", "blofy_profiles").forEach { app.getSharedPreferences(it, 0).edit().clear().commit() }
        dao.upsertStreams(listOf(movie, series, live, stream("movie", "2"), stream("series", "42", "other")))
        dao.upsertEpisodes(listOf(episode, episode.copy(key = "p:episode:8", seriesId = "missing")))
        ParentalGate.setPin(app, "1234")
    }
    @After fun close() {
        controllers.asReversed().forEach { it.pause().stop().destroy() }
        ParentalGate.clearPin(app)
    }

    @Test fun wrongPinDoesNotLoadAndCancelFinishesTheDestination() {
        val page = open(Probe::class.java)
        prompt(); assertFalse(page.loaded)
        answer("9999"); assertFalse(page.loaded); assertTrue(prompt().isShowing)
        prompt().getButton(AlertDialog.BUTTON_NEGATIVE).performClick(); idle()
        assertFalse(page.loaded); assertTrue(page.isFinishing)
    }

    @Test fun allRealContentDestinationsCheckBeforeLoadingOrPlaying() {
        val targets = listOf(
            MovieDetailsActivity::class.java to intent(MovieDetailsActivity::class.java),
            SeriesDetailsActivity::class.java to intent(SeriesDetailsActivity::class.java, series.key),
            EpisodesActivity::class.java to intent(EpisodesActivity::class.java, "").putExtra("series_id", "42"),
            CatchupActivity::class.java to intent(CatchupActivity::class.java, live.key),
            PlayerActivity::class.java to intent(PlayerActivity::class.java, episode.key)
        )
        targets.forEach { (type, source) ->
            val page = open(type, source)
            prompt(); answer("9999")
            if (page is PlayerActivity) {
                assertNull(PlayerActivity::class.java.getDeclaredField("session").apply { isAccessible = true }.get(page))
            }
            prompt().cancel(); idle(); assertTrue("${type.simpleName} must close on cancel", page.isFinishing)
        }
    }

    @Test fun validPinStartsThePlayerOnlyAfterApproval() {
        val page = open(PlayerLifecycleTest.TestPlayerActivity::class.java,
            intent(PlayerLifecycleTest.TestPlayerActivity::class.java, episode.key))
        prompt(); assertTrue(page.players.isEmpty())
        answer("9999"); assertTrue(page.players.isEmpty())
        answer("1234"); await { page.players.size == 1 }
        assertEquals(1, page.players.single().prepares)
    }

    @Test fun sameSeriesHandoffIsSingleUseAndDoesNotUnlockAnotherMovie() {
        val page = open(Probe::class.java, intent(Probe::class.java, series.key))
        answer("1234"); assertTrue(page.loaded)
        val handoff = intent(Probe::class.java, episode.key)
        page.transfer(handoff)
        val copied = Intent(handoff)
        val episodePage = open(Probe::class.java, handoff)
        await { episodePage.loaded }
        assertFalse(ShadowAlertDialog.getLatestAlertDialog().isShowing)
        val replay = open(Probe::class.java, copied)
        prompt(); assertFalse(replay.loaded); prompt().cancel(); idle()
        val other = intent(Probe::class.java, movie.key)
        page.transfer(other)
        val moviePage = open(Probe::class.java, other)
        prompt(); assertFalse(moviePage.loaded)
    }

    @Test fun profileOrPinChangesInvalidateAHandoff() {
        val page = open(Probe::class.java)
        answer("1234")
        val source = intent(Probe::class.java)
        page.transfer(source)
        ParentalGate.setPin(app, "5678")
        val child = open(Probe::class.java, source)
        prompt(); assertFalse(child.loaded)
        answer("1234"); assertFalse(child.loaded)
        answer("5678"); assertTrue(child.loaded)
        val changedProfile = intent(Probe::class.java)
        child.transfer(changedProfile)
        ProfileStore.select(app, ProfileStore.create(app, "Other").id)
        val other = open(Probe::class.java, changedProfile)
        prompt(); assertFalse(other.loaded)
    }

    @Test fun keysFromAnotherProviderAndMissingEpisodeParentsFailClosed() {
        val foreign = open(Probe::class.java, intent(Probe::class.java, movie.key, "other"))
        await { foreign.isFinishing }; assertFalse(foreign.loaded)
        val missing = open(Probe::class.java, intent(Probe::class.java, "p:episode:8"))
        await { missing.isFinishing }; assertFalse(missing.loaded)
    }

    @Test fun kidsCannotOpenALockedSeriesThroughAnEpisodeEvenWithCorrectPin() {
        ProfileStore.select(app, "kids")
        val page = open(Probe::class.java, intent(Probe::class.java, episode.key))
        await { page.isFinishing }; assertFalse(page.loaded)
    }

    @Test fun kidsPolicyAllowsOrdinaryNamesAndBlocksAdultParentMetadata() {
        runBlocking(Dispatchers.IO) { dao.upsertStreams(listOf(series.copy(locked = false, name = "Essex family"))) }
        run {
            ProfileStore.select(app, "kids")
            val page = open(Probe::class.java, intent(Probe::class.java, episode.key))
            await { page.loaded }
        }
        runBlocking(Dispatchers.IO) { dao.upsertStreams(listOf(series.copy(locked = false, genre = "TV-MA"))) }
        run {
            val page = open(Probe::class.java, intent(Probe::class.java, episode.key))
            await { page.isFinishing }; assertFalse(page.loaded)
        }
    }

    @Test fun catchupInheritsTheChannelLock(): Unit = runBlocking(Dispatchers.IO) {
        assertEquals(live, ContentAccessGate.resolve(dao, "p", "${live.key}:catchup:1700000000"))
        assertNull(ContentAccessGate.resolve(dao, "p", "${movie.key}:catchup:1700000000"))
        assertNull(ContentAccessGate.resolve(dao, "p", "${live.key}:catchup:bad"))
    }

    @Test fun noConfiguredPinKeepsExistingSynchronousStartup() {
        ParentalGate.clearPin(app)
        assertTrue(open(Probe::class.java, intent(Probe::class.java, "legacy-missing-key")).loaded)
    }

    @Test fun switchingToAnotherLockedChannelRequiresNewApproval() {
        val page = open(Probe::class.java)
        answer("1234")
        var switched = false
        page.switch(live.key) { switched = true }
        prompt(); answer("9999"); assertFalse(switched)
        answer("1234"); assertTrue(switched)
    }

    @Test fun destroyingAPendingDestinationCannotStartItsContent() {
        val page = open(Probe::class.java)
        val dialog = prompt()
        controllers.single().pause().stop().destroy(); controllers.clear()
        idle(); assertFalse(dialog.isShowing); assertFalse(page.loaded)
    }
}
