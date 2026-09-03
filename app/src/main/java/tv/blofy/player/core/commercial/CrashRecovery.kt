package tv.blofy.player.core.commercial

import android.app.Application
import android.os.Handler
import android.os.Looper

/** Detects repeated unstable launches and temporarily falls back to the lightweight policy. */
object CrashRecovery {
    private const val PREFS = "blofy_crash_recovery"
    private const val KEY_LAST_START = "last_start"
    private const val KEY_STABLE = "stable"
    private const val KEY_UNSTABLE_COUNT = "unstable_count"
    private const val CRASH_WINDOW_MS = 15L * 60L * 1000L
    private const val STABLE_AFTER_MS = 45_000L
    private const val AUTO_SAFE_THRESHOLD = 3

    @Synchronized
    fun install(application: Application) {
        val prefs = application.getSharedPreferences(PREFS, Application.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val previousStart = prefs.getLong(KEY_LAST_START, 0L)
        val previousStable = prefs.getBoolean(KEY_STABLE, true)
        val previousCount = prefs.getInt(KEY_UNSTABLE_COUNT, 0)
        val inWindow = previousStart > 0L && now - previousStart <= CRASH_WINDOW_MS
        val count = if (!previousStable && inWindow) previousCount + 1 else 0

        prefs.edit()
            .putLong(KEY_LAST_START, now)
            .putBoolean(KEY_STABLE, false)
            .putInt(KEY_UNSTABLE_COUNT, count)
            .apply()

        if (count >= AUTO_SAFE_THRESHOLD) {
            CommercialRuntime.enableAutomaticSafeMode(application, "تكرار توقف التطبيق")
        }

        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            prefs.edit().putBoolean(KEY_STABLE, false).apply()
            previousHandler?.uncaughtException(thread, throwable)
        }

        Handler(Looper.getMainLooper()).postDelayed({
            prefs.edit()
                .putBoolean(KEY_STABLE, true)
                .putInt(KEY_UNSTABLE_COUNT, 0)
                .apply()
        }, STABLE_AFTER_MS)
    }
}
