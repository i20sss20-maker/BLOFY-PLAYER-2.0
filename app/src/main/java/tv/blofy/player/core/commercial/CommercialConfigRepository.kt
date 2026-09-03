package tv.blofy.player.core.commercial

import android.content.Context
import com.google.gson.Gson
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.DeviceIdentity
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Last-known-good commercial configuration. A malformed or unavailable remote response never
 * replaces the last valid configuration and therefore cannot strand a device on a broken setup.
 */
object CommercialConfigRepository {
    data class Config(
        val revision: Long = 0L,
        val flags: Map<String, Boolean> = emptyMap(),
        val rollouts: Map<String, Int> = emptyMap(),
        val imageMode: String = "balanced",
        val fetchedAt: Long = System.currentTimeMillis()
    )

    private data class HealthResponse(val commercial: RemoteConfig? = null)
    private data class RemoteConfig(
        val revision: Long = 0L,
        val flags: Map<String, Boolean>? = null,
        val rollouts: Map<String, Int>? = null,
        val imageMode: String? = null
    )

    private const val PREFS = "blofy_commercial_config"
    private const val KEY_CACHE = "last_known_good"
    private const val KEY_LAST_CHECK = "last_check"
    private const val CACHE_TTL_MS = 6L * 60L * 60L * 1000L
    private const val MAX_STALE_MS = 30L * 24L * 60L * 60L * 1000L

    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(7, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    suspend fun refresh(context: Context, force: Boolean = false): Config {
        val app = context.applicationContext
        val now = System.currentTimeMillis()
        val cached = cached(app)
        if (!force && cached != null && now - cached.fetchedAt <= CACHE_TTL_MS) return cached

        val base = BuildConfig.ACTIVATION_BASE_URL.trim().trimEnd('/')
        if (!safeBase(base)) return usable(cached, now) ?: defaults(now)

        val request = Request.Builder()
            .url("$base/health")
            .header("Accept", "application/json")
            .header("User-Agent", "BLOFY-PLAYER/${BuildConfig.VERSION_NAME}")
            .get()
            .build()
        val fetched = runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val raw = response.body?.string() ?: return@use null
                validate(gson.fromJson(raw, HealthResponse::class.java).commercial, now)
            }
        }.getOrNull()

        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(KEY_LAST_CHECK, now).apply()
        if (fetched != null) {
            write(app, fetched)
            return fetched
        }
        return usable(cached, now) ?: defaults(now)
    }

    fun cached(context: Context): Config? {
        val raw = context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CACHE, null)
            ?: return null
        return runCatching { gson.fromJson(raw, Config::class.java) }
            .getOrNull()
            ?.takeIf(::valid)
    }

    fun current(context: Context): Config = cached(context) ?: defaults(System.currentTimeMillis())

    fun enabled(context: Context, feature: String, defaultValue: Boolean = true): Boolean {
        val config = current(context)
        val configured = config.flags[feature] ?: defaultValue
        if (!configured) return false
        val percent = (config.rollouts[feature] ?: 100).coerceIn(0, 100)
        if (percent >= 100) return true
        if (percent <= 0) return false
        return bucket(DeviceIdentity.deviceId(context), feature, config.revision) < percent
    }

    fun lastCheckedAt(context: Context): Long = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getLong(KEY_LAST_CHECK, 0L)

    private fun validate(remote: RemoteConfig?, now: Long): Config? {
        remote ?: return null
        if (remote.revision < 0L) return null
        val flags = remote.flags.orEmpty()
            .filterKeys { FEATURE_KEY.matches(it) }
            .toSortedMap()
        val rollouts = remote.rollouts.orEmpty()
            .filterKeys { FEATURE_KEY.matches(it) }
            .mapValues { (_, value) -> value.coerceIn(0, 100) }
            .toSortedMap()
        val imageMode = remote.imageMode
            ?.lowercase()
            ?.takeIf { it in IMAGE_MODES }
            ?: "balanced"
        return Config(remote.revision, flags, rollouts, imageMode, now)
    }

    private fun valid(config: Config): Boolean =
        config.revision >= 0L &&
            config.imageMode in IMAGE_MODES &&
            config.flags.keys.all(FEATURE_KEY::matches) &&
            config.rollouts.all { FEATURE_KEY.matches(it.key) && it.value in 0..100 }

    private fun write(context: Context, config: Config) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_CACHE, gson.toJson(config)).apply()
    }

    private fun usable(config: Config?, now: Long): Config? =
        config?.takeIf { valid(it) && now - it.fetchedAt <= MAX_STALE_MS }

    private fun defaults(now: Long) = Config(
        revision = 0L,
        flags = CommercialRuntime.DEFAULT_FLAGS,
        rollouts = emptyMap(),
        imageMode = "balanced",
        fetchedAt = now
    )

    private fun bucket(deviceId: String, feature: String, revision: Long): Int {
        val value = "$deviceId|$feature|$revision".toByteArray(Charsets.UTF_8)
        val digest = MessageDigest.getInstance("SHA-256").digest(value)
        val unsigned = ((digest[0].toInt() and 0xff) shl 8) or (digest[1].toInt() and 0xff)
        return unsigned % 100
    }

    private fun safeBase(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme.equals("https", true) &&
            !uri.host.isNullOrBlank() &&
            uri.userInfo == null &&
            uri.query == null &&
            uri.fragment == null
    }.getOrDefault(false)

    private val FEATURE_KEY = Regex("^[a-z][a-z0-9_.-]{1,47}$")
    private val IMAGE_MODES = setOf("economy", "balanced", "high")
}
