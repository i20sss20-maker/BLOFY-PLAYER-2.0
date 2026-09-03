package tv.blofy.player.core.update

import android.content.Context
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.blofy.player.BuildConfig
import java.net.URI
import java.util.concurrent.TimeUnit

/** Reads public app release metadata from the activation service health endpoint. */
object AppReleaseRepository {
    data class Release(
        val versionCode: Int,
        val versionName: String,
        val minSupportedVersionCode: Int,
        val downloadUrl: String?,
        val releaseNotes: String?,
        val fetchedAt: Long = System.currentTimeMillis()
    ) {
        fun updateAvailable(currentVersionCode: Int = BuildConfig.VERSION_CODE): Boolean =
            versionCode > currentVersionCode

        fun updateRequired(currentVersionCode: Int = BuildConfig.VERSION_CODE): Boolean =
            minSupportedVersionCode > currentVersionCode
    }

    private data class HealthResponse(
        val release: ServiceRelease? = null
    )

    private data class ServiceRelease(
        val app: RemoteAppRelease? = null
    )

    private data class RemoteAppRelease(
        val versionCode: Int = 0,
        val versionName: String? = null,
        val minSupportedVersionCode: Int = 0,
        val downloadUrl: String? = null,
        val releaseNotes: String? = null
    )

    private const val PREFS = "blofy_app_release"
    private const val KEY_CACHE = "release_json"
    private const val KEY_LAST_CHECK = "last_check"
    private const val CACHE_TTL_MS = 6L * 60L * 60L * 1000L
    private const val MAX_STALE_CACHE_MS = 7L * 24L * 60L * 60L * 1000L

    private val gson = Gson()
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(7, TimeUnit.SECONDS)
        .build()

    suspend fun check(context: Context, force: Boolean = false): Release? =
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            val cached = cached(app)
            val now = System.currentTimeMillis()
            if (!force && cached != null && now - cached.fetchedAt <= CACHE_TTL_MS) {
                return@withContext cached
            }

            val base = BuildConfig.ACTIVATION_BASE_URL.trim().trimEnd('/')
            if (!isSafeBaseUrl(base)) return@withContext usableStaleCache(cached, now)

            val request = Request.Builder()
                .url("$base/health")
                .header("Accept", "application/json")
                .header(
                    "User-Agent",
                    "BLOFY-PLAYER/${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"
                )
                .get()
                .build()

            val fetched = runCatching {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    val body = response.body?.string() ?: return@use null
                    val remote = gson.fromJson(body, HealthResponse::class.java)
                        .release
                        ?.app
                        ?: return@use null
                    validate(remote)
                }
            }.getOrNull()

            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_LAST_CHECK, now)
                .apply()

            if (fetched != null) {
                writeCache(app, fetched)
                fetched
            } else {
                usableStaleCache(cached, now)
            }
        }

    fun cached(context: Context): Release? {
        val raw = context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CACHE, null)
            ?: return null
        return runCatching { gson.fromJson(raw, Release::class.java) }
            .getOrNull()
            ?.takeIf(::isValidRelease)
    }

    fun lastCheckedAt(context: Context): Long =
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_LAST_CHECK, 0L)

    private fun validate(remote: RemoteAppRelease): Release? {
        val name = remote.versionName?.trim()?.takeIf {
            it.isNotEmpty() && it.length <= 64
        } ?: return null
        if (remote.versionCode <= 0) return null

        val minimum = remote.minSupportedVersionCode
            .coerceAtLeast(1)
            .coerceAtMost(remote.versionCode)
        val url = remote.downloadUrl
            ?.trim()
            ?.takeIf(::isSafeDownloadUrl)
        val notes = remote.releaseNotes
            ?.replace(Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]"), "")
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?.take(600)

        return Release(
            versionCode = remote.versionCode,
            versionName = name,
            minSupportedVersionCode = minimum,
            downloadUrl = url,
            releaseNotes = notes
        )
    }

    private fun writeCache(context: Context, release: Release) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CACHE, gson.toJson(release))
            .apply()
    }

    private fun usableStaleCache(cached: Release?, now: Long): Release? =
        cached?.takeIf { now - it.fetchedAt <= MAX_STALE_CACHE_MS }

    private fun isValidRelease(release: Release): Boolean =
        release.versionCode > 0 &&
            release.versionName.isNotBlank() &&
            release.versionName.length <= 64 &&
            release.minSupportedVersionCode in 1..release.versionCode &&
            (release.downloadUrl == null || isSafeDownloadUrl(release.downloadUrl))

    private fun isSafeBaseUrl(value: String): Boolean {
        if (value.isBlank()) return false
        return runCatching {
            val uri = URI(value)
            uri.scheme.equals("https", true) &&
                !uri.host.isNullOrBlank() &&
                uri.userInfo == null &&
                uri.query == null &&
                uri.fragment == null
        }.getOrDefault(false)
    }

    private fun isSafeDownloadUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme.equals("https", true) &&
            !uri.host.isNullOrBlank() &&
            uri.userInfo == null
    }.getOrDefault(false)
}
