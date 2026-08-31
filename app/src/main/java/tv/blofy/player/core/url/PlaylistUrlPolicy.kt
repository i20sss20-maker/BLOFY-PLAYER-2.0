package tv.blofy.player.core.url

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Release transport policy for playlist/provider endpoints. */
object PlaylistUrlPolicy {
    enum class Result { VALID, EMPTY, INVALID, HTTPS_REQUIRED }

    fun validate(value: String): Result {
        val candidate = value.trim()
        if (candidate.isBlank()) return Result.EMPTY
        val url = candidate.toHttpUrlOrNull() ?: return Result.INVALID
        return if (url.isHttps) Result.VALID else Result.HTTPS_REQUIRED
    }

    fun isValid(value: String): Boolean = validate(value) == Result.VALID
}
