package tv.blofy.player.core.update

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
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
        if (!force && !processCheckStarted.compareAndSet(false, true)) return
        activity.lifecycleScope.launch {
            val release = AppReleaseRepository.check(activity, force)
            if (activity.isFinishing || activity.isDestroyed) return@launch

            if (release == null) {
                if (force) {
                    Toast.makeText(
                        activity,
                        "تعذر قراءة معلومات التحديث الآن",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return@launch
            }

            if (!release.updateAvailable()) {
                if (force) {
                    Toast.makeText(
                        activity,
                        "أنت على أحدث إصدار: ${BuildConfig.VERSION_NAME}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                return@launch
            }

            if (release.downloadUrl.isNullOrBlank()) {
                if (force) {
                    Toast.makeText(
                        activity,
                        "يوجد إصدار ${release.versionName} لكن رابط التحديث غير مضبوط",
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
            ?.let { "\n\nأبرز التغييرات:\n$it" }
            .orEmpty()
        val message = buildString {
            append("الإصدار الحالي: ${BuildConfig.VERSION_NAME}\n")
            append("الإصدار الجديد: ${release.versionName}")
            if (required) append("\n\nهذا التحديث مهم لاستمرار أفضل توافق مع الخدمة.")
            append(notes)
        }

        val dialog = AlertDialog.Builder(activity)
            .setTitle(if (required) "تحديث BLOFY مهم" else "يتوفر تحديث جديد")
            .setMessage(message)
            .setPositiveButton("تحديث الآن") { _, _ ->
                openDownload(activity, release.downloadUrl.orEmpty())
            }
            .setNegativeButton(if (required) "لاحقًا" else "ليس الآن", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
        }
        dialog.show()
    }

    private fun openDownload(activity: AppCompatActivity, url: String) {
        if (url.isBlank()) return
        try {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                }
            )
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(
                activity,
                "لا يوجد تطبيق قادر على فتح رابط التحديث",
                Toast.LENGTH_LONG
            ).show()
        }
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
