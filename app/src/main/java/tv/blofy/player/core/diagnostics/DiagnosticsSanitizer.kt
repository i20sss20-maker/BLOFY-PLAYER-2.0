package tv.blofy.player.core.diagnostics

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

/**
 * Removes provider credentials from values that can leave the device as diagnostics.
 *
 * Stream URLs are intentionally reduced to an origin plus a small, non-sensitive hint.
 * Keeping arbitrary path/query values is unsafe because Xtream credentials are commonly
 * embedded in both places.
 */
object DiagnosticsSanitizer {
    private const val REDACTED_URL = "<redacted-url>"
    private const val REDACTED_VALUE = "***"
    private const val REDACTED_HOST = "redacted.invalid"

    private val allowedSchemes = setOf("http", "https", "rtmp", "rtsp")
    private val pathKinds = setOf("live", "movie", "series", "stream", "play", "hls", "timeshift", "catchup")
    private val safeExtensions = setOf("ts", "m3u8", "m3u", "mp4", "mkv", "avi", "mov", "webm", "mpd", "php")
    private val controlCharacters = Regex("[\\u0000-\\u001F\\u007F]")
    private val embeddedUrl = Regex("(?i)\\b(?:https?|rtmp|rtsp)://\\S+")
    private val schemeLessUrl = Regex(
        "(?i)\\b(?:(?:[a-z0-9-]+\\.)+[a-z]{2,}|(?:\\d{1,3}\\.){3}\\d{1,3})" +
            "(?::\\d{1,5})?/[^\\s<>\\\"']+"
    )
    private val relativeStreamPath = Regex(
        "(?i)(^|[\\s(\\\"'=])/(?:live|movie|series|stream|play|hls|timeshift|catchup)/[^\\s<>\\\"']+"
    )
    private val bareHost = Regex(
        "(?i)(?:\\[[0-9a-f:]+\\](?::\\d{1,5})?|\\b(?:(?:[a-z0-9-]+\\.)+[a-z]{2,}|" +
            "(?:\\d{1,3}\\.){3}\\d{1,3})(?::\\d{1,5})?\\b)"
    )
    private val authorizationCredential = Regex("(?i)\\b(?:Bearer|Basic|Token)\\s+[A-Za-z0-9._~+/=-]+")
    private val authorityCredentials = Regex("(?i)\\b[^\\s/@:]+:[^\\s/@]+@\\S+")
    private val sensitiveKeyValue = Regex(
        "(?i)(\\b(?:user(?:name)?|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|" +
            "api[_-]?key|apikey|authorization|auth|secret|url|uri|endpoint)\\b\\s*[\\\"']?\\s*[:=]\\s*)" +
            "(?:\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;}\\]]+)"
    )
    private val providerPseudonym = Regex("^provider-[a-f0-9]{16}$")
    private val contentKinds = setOf("live", "movie", "series", "episode", "catchup", "unknown")

    fun sanitizeUrl(value: String, maxLength: Int = 1024): String {
        val clean = stripControls(value).trim().take(8_192)
        if (clean.isBlank()) return REDACTED_URL.take(maxLength.coerceAtLeast(0))

        val uri = runCatching { URI(clean) }.getOrNull()
        val scheme = uri?.scheme?.lowercase(Locale.ROOT)
        val host = uri?.host
        if (scheme !in allowedSchemes || host.isNullOrBlank()) {
            return REDACTED_URL.take(maxLength.coerceAtLeast(0))
        }

        val rawPath = uri.rawPath.orEmpty()
        val firstSegment = rawPath.split('/').firstOrNull { it.isNotBlank() }?.lowercase(Locale.ROOT)
        val kind = firstSegment?.takeIf { it in pathKinds }
        val extension = Regex("(?i)\\.([a-z0-9]{1,8})$").find(rawPath)
            ?.groupValues
            ?.get(1)
            ?.lowercase(Locale.ROOT)
            ?.takeIf { it in safeExtensions }
            ?.let { ".$it" }
            .orEmpty()
        val pathHint = if (kind == null) "/$REDACTED_VALUE$extension" else "/$kind/$REDACTED_VALUE$extension"

        return "$scheme://$REDACTED_HOST$pathHint".take(maxLength.coerceAtLeast(0))
    }

    fun sanitizeMessage(value: String?, maxLength: Int = 512): String? {
        if (value.isNullOrBlank()) return null

        var clean = stripControls(value)
        clean = embeddedUrl.replace(clean, REDACTED_URL)
        clean = schemeLessUrl.replace(clean, REDACTED_URL)
        clean = relativeStreamPath.replace(clean) { match -> "${match.groupValues[1]}$REDACTED_URL" }
        clean = authorityCredentials.replace(clean, REDACTED_URL)
        clean = bareHost.replace(clean, "<redacted-host>")
        clean = authorizationCredential.replace(clean, REDACTED_VALUE)
        clean = sensitiveKeyValue.replace(clean) { match -> "${match.groupValues[1]}$REDACTED_VALUE" }
        return clean.trim().take(maxLength.coerceAtLeast(0)).ifBlank { null }
    }

    fun pseudonymizeProviderKey(value: String): String {
        val clean = stripControls(value).trim().take(2_048)
        if (clean.isBlank()) return "provider-unknown"
        if (providerPseudonym.matches(clean)) return clean
        val digest = MessageDigest.getInstance("SHA-256").digest(clean.toByteArray(Charsets.UTF_8))
        val shortHash = digest.take(8).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
        return "provider-$shortHash"
    }

    fun sanitizeContentKind(value: String): String {
        val clean = value.trim().lowercase(Locale.ROOT)
        return clean.takeIf { it in contentKinds } ?: "unknown"
    }

    fun sanitizeErrorCode(value: String?): String? {
        val clean = value?.trim().orEmpty()
        return clean.takeIf { it.matches(Regex("^ERROR_CODE_[A-Z0-9_]{1,117}$")) }
    }

    fun sanitizeAppVersion(value: String?): String? {
        val clean = value?.trim().orEmpty()
        if (clean == "ci") return clean
        return clean.takeIf {
            it.matches(Regex("^\\d{1,4}(?:\\.\\d{1,4}){1,3}(?:[-+][A-Za-z0-9.-]{1,32})?$"))
        }
    }

    private fun stripControls(value: String): String = controlCharacters.replace(value, " ")
}
