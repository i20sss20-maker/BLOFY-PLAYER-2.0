package tv.blofy.player.core.url

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.InetAddress
import java.util.Locale

/** Transport policy for user-provided playlist/provider endpoints. */
object PlaylistUrlPolicy {
    enum class Result {
        VALID,
        HTTP_CLEAR_TEXT,
        EMPTY,
        INVALID,
        USER_INFO_NOT_ALLOWED,
        UNSAFE_HOST
    }

    fun validate(value: String): Result {
        val candidate = value.trim()
        if (candidate.isBlank()) return Result.EMPTY
        if (candidate.any { it.isWhitespace() || it.code < 0x20 || it.code == 0x7f }) return Result.INVALID

        val explicitHttpScheme = candidate.startsWith("http://", ignoreCase = true)
        val explicitHttpsScheme = candidate.startsWith("https://", ignoreCase = true)
        if (!explicitHttpScheme && !explicitHttpsScheme) return Result.INVALID

        val url = candidate.toHttpUrlOrNull() ?: return Result.INVALID
        if (hasUserInfo(candidate, url.encodedUsername, url.encodedPassword)) {
            return Result.USER_INFO_NOT_ALLOWED
        }
        if (url.port !in 1..65535 || isUnsafeHost(url.host)) return Result.UNSAFE_HOST

        return if (url.isHttps) Result.VALID else Result.HTTP_CLEAR_TEXT
    }

    fun isValid(value: String): Boolean = validate(value) in setOf(Result.VALID, Result.HTTP_CLEAR_TEXT)

    fun isClearText(value: String): Boolean = validate(value) == Result.HTTP_CLEAR_TEXT

    private fun hasUserInfo(candidate: String, encodedUsername: String, encodedPassword: String): Boolean {
        if (encodedUsername.isNotEmpty() || encodedPassword.isNotEmpty()) return true

        val authorityStart = candidate.indexOf("://").takeIf { it >= 0 }?.plus(3) ?: return false
        val authorityEnd = candidate.indexOfAny(charArrayOf('/', '?', '#'), authorityStart)
            .takeIf { it >= 0 }
            ?: candidate.length
        return candidate.substring(authorityStart, authorityEnd).contains('@')
    }

    private fun isUnsafeHost(host: String): Boolean {
        val normalized = host.trimEnd('.').lowercase(Locale.US)
        if (normalized.isBlank()) return true
        if (
            normalized == "localhost" ||
            normalized.endsWith(".localhost") ||
            normalized.endsWith(".local") ||
            normalized.endsWith(".internal") ||
            normalized.endsWith(".lan") ||
            normalized.endsWith(".home") ||
            normalized.endsWith(".home.arpa")
        ) return true

        parseIpv4(normalized)?.let { return isUnsafeIpv4(it) }
        if (normalized.contains(':')) return isUnsafeIpv6(normalized)

        // A single-label hostname is only meaningful on the local network.
        return !normalized.contains('.')
    }

    private fun parseIpv4(host: String): IntArray? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        return parts.map { part ->
            if (part.isEmpty() || part.any { !it.isDigit() }) return null
            part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
        }.toIntArray()
    }

    private fun isUnsafeIpv4(parts: IntArray): Boolean {
        val a = parts[0]
        val b = parts[1]
        return a == 0 ||
            a == 10 ||
            a == 127 ||
            (a == 100 && b in 64..127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 0) ||
            (a == 192 && b == 168) ||
            (a == 198 && b in 18..19) ||
            a >= 224
    }

    private fun isUnsafeIpv6(host: String): Boolean {
        val address = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return true
        val bytes = address.address
        if (bytes.size == 4) {
            return isUnsafeIpv4(bytes.map { it.toInt() and 0xff }.toIntArray())
        }
        if (bytes.size != 16) return true

        val first = bytes[0].toInt() and 0xff
        val second = bytes[1].toInt() and 0xff
        val allZero = bytes.all { it.toInt() == 0 }
        val loopback = bytes.dropLast(1).all { it.toInt() == 0 } && (bytes.last().toInt() and 0xff) == 1
        val uniqueLocal = first and 0xfe == 0xfc
        val linkLocal = first == 0xfe && second and 0xc0 == 0x80
        val multicast = first == 0xff
        val documentation = first == 0x20 && second == 0x01 &&
            (bytes[2].toInt() and 0xff) == 0x0d && (bytes[3].toInt() and 0xff) == 0xb8
        return allZero || loopback || uniqueLocal || linkLocal || multicast || documentation
    }
}
