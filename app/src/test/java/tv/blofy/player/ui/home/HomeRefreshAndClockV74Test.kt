package tv.blofy.player.ui.home

import android.app.Application
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import androidx.work.WorkInfo
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class, qualifiers = "ar-rSA-w960dp-h540dp-land-xhdpi")
class HomeRefreshAndClockV74Test {
    @Test fun tvHeaderHasFocusableRefreshButNoFourWorldClocks() {
        val activity = home(DeviceClass.Kind.TV)
        val root = build(activity, "buildTvHome")
        val button = root.findViewWithTag<View>("blofy_home_refresh_button")
        assertNotNull(button)
        assertTrue(button.isFocusable)
        assertEquals(activity.getString(R.string.home_catalog_refresh_v74), button.contentDescription.toString())
        assertTrue(allText(root).none { text ->
            text.contains("الرياض") || text.contains("لندن") ||
                text.contains("دبي") || text.contains("نيويورك")
        })
    }

    @Test fun progressSpinnerOnlyShowsWhenWorkerRuns() {
        val activity = home(DeviceClass.Kind.TV)
        build(activity, "buildTvHome")
        val spinner = HomeActivity::class.java.getDeclaredField("refreshSpinner").apply {
            isAccessible = true
        }.get(activity) as ProgressBar
        val setter = HomeActivity::class.java.getDeclaredMethod(
            "renderManualRefreshStatus", WorkInfo.State::class.java
        ).apply { isAccessible = true }
        assertEquals(View.GONE, spinner.visibility)
        setter.invoke(activity, WorkInfo.State.ENQUEUED)
        // Waiting for network, WorkManager or playback is not active progress.
        assertEquals(View.GONE, spinner.visibility)
        setter.invoke(activity, WorkInfo.State.RUNNING)
        assertEquals(View.VISIBLE, spinner.visibility)
        setter.invoke(activity, WorkInfo.State.FAILED)
        assertEquals(View.GONE, spinner.visibility)
    }


    @Test fun manualRefreshShowsResultBrieflyAndRestoresButton() {
        val activity = home(DeviceClass.Kind.TV)
        build(activity, "buildTvHome")
        val hint = HomeActivity::class.java.getDeclaredField("refreshHint").apply {
            isAccessible = true
        }.get(activity) as TextView
        val button = HomeActivity::class.java.getDeclaredField("refreshButton").apply {
            isAccessible = true
        }.get(activity) as android.widget.Button
        val setter = HomeActivity::class.java.getDeclaredMethod(
            "renderManualRefreshStatus", WorkInfo.State::class.java
        ).apply { isAccessible = true }
        assertEquals(View.GONE, hint.visibility)
        // Previously finished work must not leave a stale banner on entry.
        setter.invoke(activity, WorkInfo.State.SUCCEEDED)
        assertEquals(View.GONE, hint.visibility)

        HomeActivity::class.java.getDeclaredField("refreshStartedHere").apply {
            isAccessible = true
        }.setBoolean(activity, true)
        setter.invoke(activity, WorkInfo.State.ENQUEUED)
        assertTrue(button.isEnabled)
        assertEquals(activity.getString(R.string.home_catalog_refresh_cancel_v75), button.text.toString())
        assertEquals(View.VISIBLE, hint.visibility)
        assertFalse(hint.text.toString().contains("أو انتهاء التشغيل"))
        setter.invoke(activity, WorkInfo.State.RUNNING)
        assertTrue(button.isEnabled)
        assertEquals(activity.getString(R.string.home_catalog_refresh_cancel_v75), button.contentDescription.toString())
        setter.invoke(activity, WorkInfo.State.FAILED)
        assertTrue(button.isEnabled)
        assertEquals(activity.getString(R.string.home_catalog_refresh_failed_v74), hint.text.toString())
    }

    @Test fun runningRefreshMovesToHonestBackgroundStatusInsteadOfEndlessSpinner() {
        val activity = home(DeviceClass.Kind.TV)
        build(activity, "buildTvHome")
        val spinner = HomeActivity::class.java.getDeclaredField("refreshSpinner").apply {
            isAccessible = true
        }.get(activity) as ProgressBar
        val hint = HomeActivity::class.java.getDeclaredField("refreshHint").apply {
            isAccessible = true
        }.get(activity) as TextView
        val setter = HomeActivity::class.java.getDeclaredMethod(
            "renderManualRefreshStatus", WorkInfo.State::class.java
        ).apply { isAccessible = true }
        setter.invoke(activity, WorkInfo.State.RUNNING)
        assertEquals(View.VISIBLE, spinner.visibility)
        HomeActivity::class.java.getDeclaredField("refreshActiveSinceMs").apply {
            isAccessible = true
        }.setLong(activity, android.os.SystemClock.elapsedRealtime() - 20_000L)
        HomeActivity::class.java.getDeclaredMethod("updateRefreshFeedback").apply {
            isAccessible = true
        }.invoke(activity)
        assertEquals(View.GONE, spinner.visibility)
        assertTrue(hint.text.toString().contains(
            activity.getString(R.string.home_catalog_refresh_background_v75)
        ))
        setter.invoke(activity, WorkInfo.State.SUCCEEDED)
        assertEquals(View.GONE, spinner.visibility)
    }

    @Test fun cinematicHomeHasVisibleHeroAccentAndBrandedRoot() {
        val activity = home(DeviceClass.Kind.TV)
        val root = build(activity, "buildTvHome")
        assertEquals("blofy_home_cinema_root_v75", root.tag)
        val hero = root.findViewWithTag<View>("blofy_home_hero")
        assertNotNull(hero)
        assertNotNull(hero.findViewWithTag<View>("blofy_hero_plum_accent_v75"))
    }

    @Test fun heroAndShelvesHandleLongMixedLanguageTitles() {
        val activity = home(DeviceClass.Kind.TV)
        val root = build(activity, "buildTvHome")
        assertNotNull(root.findViewWithTag<View>("blofy_home_hero"))
        fun heroText(field: String): TextView =
            HomeActivity::class.java.getDeclaredField(field).apply { isAccessible = true }
                .get(activity) as TextView
        assertEquals(2, heroText("heroTitle").maxLines)
        assertEquals(2, heroText("heroMeta").maxLines)
        assertTrue(heroText("heroTitle").ellipsize != null)

        val titleWithSubtitle = HomeActivity::class.java.getDeclaredMethod(
            "sectionTitle", String::class.java, String::class.java
        ).apply { isAccessible = true }.invoke(activity, "الأحدث", "أفلام ومسلسلات أضيفت حديثًا") as ViewGroup
        assertEquals(2, titleWithSubtitle.childCount)
        assertTrue(allText(titleWithSubtitle).contains("أفلام ومسلسلات أضيفت حديثًا"))
    }

    private fun home(kind: DeviceClass.Kind): HomeActivity =
        Robolectric.buildActivity(HomeActivity::class.java).get().also { activity ->
            activity.setTheme(R.style.Theme_Blofy)
            HomeActivity::class.java.getDeclaredField("deviceKind").apply {
                isAccessible = true
            }.set(activity, kind)
        }

    private fun build(activity: HomeActivity, name: String): ViewGroup =
        HomeActivity::class.java.getDeclaredMethod(name).apply {
            isAccessible = true
        }.invoke(activity) as ViewGroup

    private fun allText(view: View): List<String> = when (view) {
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { allText(view.getChildAt(it)) }
        else -> emptyList()
    }
}
