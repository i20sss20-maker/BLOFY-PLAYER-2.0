package tv.blofy.player.ui.common

import android.app.Application
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Sanity check: Arabic UI fonts and their redistribution license ship in every APK. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class BlofyBundledArabicFontTest {
    @Test fun arabicFontsAndLicenseArePackaged() {
        val assets = RuntimeEnvironment.getApplication().assets
        listOf(
            "fonts/IBMPlexSansArabic-Regular.ttf",
            "fonts/IBMPlexSansArabic-SemiBold.ttf"
        ).forEach { path ->
            assets.open(path).use { input ->
                assertArrayEquals(byteArrayOf(0, 1, 0, 0), input.readBytes().take(4).toByteArray())
            }
        }
        assets.open("fonts/OFL-IBM-Plex-Sans-Arabic.txt").bufferedReader().use {
            check(it.readText().contains("SIL OPEN FONT LICENSE Version 1.1"))
        }
    }
}
