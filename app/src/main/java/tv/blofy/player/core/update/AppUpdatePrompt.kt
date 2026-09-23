package tv.blofy.player.core.update

import android.app.AlertDialog
import android.content.Intent
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import java.util.concurrent.atomic.AtomicBoolean

/** Displays a restrained TV-friendly update prompt without blocking normal playback. */
object AppUpdatePrompt {
    private const val PREFS = "blofy_app_update_prompt"
    private const val KEY_LAST_VERSION = "last_prompt_version"
    private const val KEY_LAST_AT = "last_prompt_at"
    private const val OPTIONAL_PROMPT_INTERVAL_MS = 24L * 60L * 60L * 1000L

    private val processCheckStarted = AtomicBoolean(false)

    fun check(activity: AppCompatActivity, force: Boolean = false) {
        if (BuildConfig.IS_GOOGLE_PLAY) {
            if (force) runCatching {
                activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(
                    "https://play.google.com/store/apps/details?id=${BuildConfig.APPLICATION_ID}")))
            }.onFailure { Toast.makeText(activity, activity.getString(tv.blofy.player.R.string.update_play_unavailable), Toast.LENGTH_SHORT).show() }
            return
        }
        if (!force && !processCheckStarted.compareAndSet(false, true)) return
        activity.lifecycleScope.launch {
            val release = AppReleaseRepository.check(activity, force)
            if (activity.isFinishing || activity.isDestroyed) return@launch

            if (release == null) {
                if (force) {
                    Toast.makeText(
                        activity,
                        activity.getString(tv.blofy.player.R.string.update_metadata_unavailable),
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return@launch
            }

            if (!release.updateAvailable()) {
                if (force) {
                    Toast.makeText(
                        activity,
                        activity.getString(tv.blofy.player.R.string.update_already_latest, BuildConfig.VERSION_NAME),
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return@launch
            }

            if (release.downloadUrl.isNullOrBlank()) {
                if (force) {
                    Toast.makeText(
                        activity,
                        activity.getString(tv.blofy.player.R.string.update_link_missing, release.versionName),
                        Toast.LENGTH_LONG
                    ).show()
                }
                return@launch
            }

            val required = release.updateRequired()
            if (!force && !required && !shouldPrompt(activity, release.versionCode)) {
                return@launch
            }
            markPrompted(activity, release.versionCode)
            show(activity, release, required)
        }
    }

    private fun show(
        activity: AppCompatActivity,
        release: AppReleaseRepository.Release,
        required: Boolean
    ) {
        val notes = release.releaseNotes
            ?.takeIf(String::isNotBlank)
            ?.let { "\n\n" + activity.getString(tv.blofy.player.R.string.update_whats_new) + ":\n" + it }
            .orEmpty()
        val message = buildString {
            append(activity.getString(tv.blofy.player.R.string.update_current_version, BuildConfig.VERSION_NAME))
            append("\n")
            append(activity.getString(tv.blofy.player.R.string.update_new_version, release.versionName))
            if (required) append("\n\n").append(activity.getString(tv.blofy.player.R.string.update_required_note))
            append(notes)
        }

        val dialog = AlertDialog.Builder(activity)
            .setTitle(activity.getString(if (required) tv.blofy.player.R.string.update_required_title else tv.blofy.player.R.string.update_available_title))
            .setMessage(message)
            .setPositiveButton(activity.getString(tv.blofy.player.R.string.update_now)) { _, _ ->
                activity.startActivity(Intent(activity, AppUpdateActivity::class.java)
                    .putExtra(AppUpdateWorker.VERSION, release.versionCode)
                    .putExtra(AppUpdateWorker.URL, release.downloadUrl)
                    .putExtra("name", release.versionName)
                    .putExtra("notes", release.releaseNotes))
            }
            .setNegativeButton(activity.getString(if (required) tv.blofy.player.R.string.update_later else tv.blofy.player.R.string.update_not_now), null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
        }
        dialog.show()
    }

    private fun shouldPrompt(
        activity: AppCompatActivity,
        versionCode: Int
    ): Boolean {
        val prefs = activity.getSharedPreferences(PREFS, AppCompatActivity.MODE_PRIVATE)
        val sameVersion = prefs.getInt(KEY_LAST_VERSION, 0) == versionCode
        val elapsed = System.currentTimeMillis() - prefs.getLong(KEY_LAST_AT, 0L)
        return !sameVersion || elapsed >= OPTIONAL_PROMPT_INTERVAL_MS
    }

    private fun markPrompted(
        activity: AppCompatActivity,
        versionCode: Int
    ) {
        activity.getSharedPreferences(PREFS, AppCompatActivity.MODE_PRIVATE)
            .edit()
            .putInt(KEY_LAST_VERSION, versionCode)
            .putLong(KEY_LAST_AT, System.currentTimeMillis())
            .apply()
    }
}
