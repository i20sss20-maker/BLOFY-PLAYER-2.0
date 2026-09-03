package tv.blofy.player.core.commercial

import android.app.ActivityManager
import android.content.Context
import android.content.res.Configuration

/** Central policy for heavy commercial features and low-memory fallbacks. */
object CommercialRuntime {
    const val FEATURE_TMDB = "tmdb"
    const val FEATURE_CAST = "cast"
    const val FEATURE_DYNAMIC_BACKDROP = "dynamic_backdrop"
    const val FEATURE_TRAILER = "trailer"
    const val FEATURE_SMART_ZAPPING = "smart_zapping"
    const val FEATURE_ZAP_PREWARM = "zap_prewarm"
    const val FEATURE_LIVE_GUIDE = "live_guide"
    const val FEATURE_AUTOPLAY_PREVIEW = "autoplay_preview"
    const val FEATURE_BACKGROUND_SYNC = "background_sync"
    const val FEATURE_CLOUD_STATE = "cloud_state"
    const val FEATURE_SUPPORT = "support_center"
    const val FEATURE_TV_HOME = "tv_home"
    const val FEATURE_IMAGE_FADE = "image_fade"

    internal val DEFAULT_FLAGS = linkedMapOf(
        FEATURE_TMDB to true,
        FEATURE_CAST to true,
        FEATURE_DYNAMIC_BACKDROP to true,
        FEATURE_TRAILER to true,
        FEATURE_SMART_ZAPPING to true,
        FEATURE_ZAP_PREWARM to true,
        FEATURE_LIVE_GUIDE to true,
        FEATURE_AUTOPLAY_PREVIEW to true,
        FEATURE_BACKGROUND_SYNC to true,
        FEATURE_CLOUD_STATE to true,
        FEATURE_SUPPORT to true,
        FEATURE_TV_HOME to true,
        FEATURE_IMAGE_FADE to true
    )

    enum class ImageMode { ECONOMY, BALANCED, HIGH }

    data class Snapshot(
        val safeMode: Boolean,
        val lowRam: Boolean,
        val imageMode: ImageMode,
        val reason: String?
    )

    private const val PREFS = "blofy_commercial_runtime"
    private const val KEY_USER_SAFE = "user_safe_mode"
    private const val KEY_AUTO_SAFE_UNTIL = "automatic_safe_until"
    private const val KEY_AUTO_SAFE_REASON = "automatic_safe_reason"
    private const val PLAYER_PREFS = "blofy_player_settings"
    private const val KEY_IMAGE_MODE = "image_quality"
    private const val KEY_MOTION = "motion_mode"

    fun feature(context: Context, key: String, defaultValue: Boolean = true): Boolean {
        if (!CommercialConfigRepository.enabled(context, key, defaultValue)) return false
        if (!safeMode(context)) return true
        return key !in SAFE_MODE_DISABLED
    }

    fun safeMode(context: Context): Boolean {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val automatic = prefs.getLong(KEY_AUTO_SAFE_UNTIL, 0L) > System.currentTimeMillis()
        return prefs.getBoolean(KEY_USER_SAFE, false) || automatic || isLowRamDevice(app)
    }

    fun setUserSafeMode(context: Context, enabled: Boolean) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_USER_SAFE, enabled).apply()
    }

    fun enableAutomaticSafeMode(context: Context, reason: String, durationMs: Long = 24L * 60L * 60L * 1000L) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_AUTO_SAFE_UNTIL, System.currentTimeMillis() + durationMs.coerceAtLeast(60_000L))
            .putString(KEY_AUTO_SAFE_REASON, reason.take(80))
            .apply()
    }

    fun clearAutomaticSafeMode(context: Context) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_AUTO_SAFE_UNTIL).remove(KEY_AUTO_SAFE_REASON).apply()
    }

    fun imageMode(context: Context): ImageMode {
        if (safeMode(context)) return ImageMode.ECONOMY
        val local = context.applicationContext
            .getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getString(KEY_IMAGE_MODE, null)
            ?.lowercase()
        val configured = local ?: CommercialConfigRepository.current(context).imageMode
        return when (configured) {
            "economy" -> ImageMode.ECONOMY
            "high" -> ImageMode.HIGH
            else -> ImageMode.BALANCED
        }
    }

    fun reducedMotion(context: Context): Boolean {
        if (safeMode(context)) return true
        return context.applicationContext
            .getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .getString(KEY_MOTION, "smooth") == "reduced"
    }

    fun isTv(context: Context): Boolean =
        context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
            Configuration.UI_MODE_TYPE_TELEVISION

    fun isLowRamDevice(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return Runtime.getRuntime().maxMemory() <= 192L * 1024L * 1024L
        return manager.isLowRamDevice || manager.memoryClass <= 192
    }

    fun snapshot(context: Context): Snapshot {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val user = prefs.getBoolean(KEY_USER_SAFE, false)
        val automatic = prefs.getLong(KEY_AUTO_SAFE_UNTIL, 0L) > System.currentTimeMillis()
        val lowRam = isLowRamDevice(app)
        val reason = when {
            user -> "يدوي"
            automatic -> prefs.getString(KEY_AUTO_SAFE_REASON, "استقرار تلقائي")
            lowRam -> "ذاكرة الجهاز محدودة"
            else -> null
        }
        return Snapshot(user || automatic || lowRam, lowRam, imageMode(app), reason)
    }

    private val SAFE_MODE_DISABLED = setOf(
        FEATURE_CAST,
        FEATURE_DYNAMIC_BACKDROP,
        FEATURE_TRAILER,
        FEATURE_ZAP_PREWARM,
        FEATURE_AUTOPLAY_PREVIEW,
        FEATURE_IMAGE_FADE
    )
}
