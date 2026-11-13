package tv.blofy.player.ui.library

import android.content.Context

/** Applies to new jobs; DownloadManager governs network suspension and resumption. */
internal object OfflineDownloadSettings {
    private const val PREFS = "blofy_offline_download_settings_v1"
    private const val WIFI_ONLY = "wifi_only"

    fun wifiOnly(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(WIFI_ONLY, false)

    fun setWifiOnly(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(WIFI_ONLY, enabled).apply()
    }
}
