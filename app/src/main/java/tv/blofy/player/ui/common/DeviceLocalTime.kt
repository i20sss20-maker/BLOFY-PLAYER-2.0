package tv.blofy.player.ui.common

import android.content.Context
import androidx.core.os.ConfigurationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formats user-visible times in the device's current time zone.
 *
 * Provider timestamps stay as absolute epoch values in storage. The conversion happens only at the
 * presentation edge so changing the device country/time zone immediately changes what BLOFY shows
 * without rewriting EPG or catalog data.
 */
object DeviceLocalTime {
    fun format(context: Context, millis: Long, pattern: String): String {
        val formatter = SimpleDateFormat(pattern, appLocale(context)).apply {
            timeZone = TimeZone.getDefault()
        }
        return formatter.format(Date(millis))
    }

    fun isSameLocalDay(context: Context, firstMillis: Long, secondMillis: Long): Boolean =
        format(context, firstMillis, "yyyyMMdd") == format(context, secondMillis, "yyyyMMdd")

    fun zoneId(): String = TimeZone.getDefault().id

    private fun appLocale(context: Context): Locale =
        ConfigurationCompat.getLocales(context.resources.configuration)[0] ?: Locale.getDefault()
}
