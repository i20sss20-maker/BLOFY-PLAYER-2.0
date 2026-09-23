package tv.blofy.player.ui.common

import android.app.Application
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class DeviceLocalTimeTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var originalZone: TimeZone

    @Before fun rememberZone() {
        originalZone = TimeZone.getDefault()
    }

    @After fun restoreZone() {
        TimeZone.setDefault(originalZone)
    }

    @Test fun sameEpochFollowsDeviceTimezone() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        assertEquals("00:00", DeviceLocalTime.format(context, 0L, "HH:mm"))

        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Riyadh"))
        assertEquals("03:00", DeviceLocalTime.format(context, 0L, "HH:mm"))
        assertEquals("Asia/Riyadh", DeviceLocalTime.zoneId())
    }

    @Test fun sameLocalDayUsesCurrentDeviceTimezone() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Riyadh"))
        val eveningUtc = 18L * 60L * 60L * 1000L
        val laterUtc = 20L * 60L * 60L * 1000L
        assertEquals(true, DeviceLocalTime.isSameLocalDay(context, eveningUtc, laterUtc))
    }
}
