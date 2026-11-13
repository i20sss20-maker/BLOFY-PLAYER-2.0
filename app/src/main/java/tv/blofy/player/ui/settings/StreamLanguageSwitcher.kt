package tv.blofy.player.ui.settings

import android.content.Intent
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.ui.home.HomeActivity
import tv.blofy.player.ui.login.CodeOnlyLoginActivity

/**
 * Android TV firmware may keep Home + Settings + Login alive during a locale
 * recreation. Switch once, clear the previous stack, and launch one new root.
 * Never touch subscription, catalog, storage, playback or credentials.
 */
internal object StreamLanguageSwitcher {
    private const val KEY = "app_language_tag"

    fun validTag(tag: String) = tag == "ar" || tag == "en"

    fun change(activity: AppCompatActivity, tag: String): Boolean {
        if (!validTag(tag)) return false
        val prefs = activity.getSharedPreferences(RuntimeSettings.PREFS, android.content.Context.MODE_PRIVATE)
        val old = AppCompatDelegate.getApplicationLocales().toLanguageTags().substringBefore(',')
        if (!prefs.edit()
                .putString(KEY, tag)
                .putString("app_language", if (tag == "ar") "العربية" else "English")
                .putBoolean("stream_language_choice_made", true)
                .commit()) return false

        // Re-tapping the already selected language must not recreate Home.
        if (tag == old) return true
        val next = if (StreamCodeSession.isClaimed(activity))
            HomeActivity::class.java else CodeOnlyLoginActivity::class.java
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
        activity.startActivity(Intent(activity, next).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK or
                Intent.FLAG_ACTIVITY_NO_ANIMATION)
        })
        @Suppress("DEPRECATION")
        activity.overridePendingTransition(0, 0)
        activity.finish()
        return true
    }
}
