package tv.blofy.player.core.identity

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Builds the public device-management URL encoded by the login-screen QR code. */
object ActivationPortalUrl {
    fun create(baseUrl: String, deviceId: String, activationCode: String): String? {
        val normalizedDeviceId = deviceId.trim()
        val normalizedCode = activationCode.trim()
        if (normalizedDeviceId.isBlank() || !normalizedCode.matches(Regex("[0-9]{6}"))) return null

        val activationEndpoint = baseUrl.trim().toHttpUrlOrNull() ?: return null
        if (!activationEndpoint.isHttps) return null

        val portal = publicPortal(activationEndpoint) ?: return null
        return portal.newBuilder()
            // Credentials stay in the fragment, so they are never sent in the HTTP request.
            .fragment("deviceId=$normalizedDeviceId&code=$normalizedCode")
            .build()
            .toString()
    }

    private fun publicPortal(endpoint: HttpUrl): HttpUrl? {
        val host = endpoint.host
        val canonicalHost = when {
            host.equals("api.blofyplayer.com", ignoreCase = true) -> "blofyplayer.com"
            host.startsWith("api.", ignoreCase = true) && host.length > 4 -> host.substring(4)
            else -> host
        }
        return endpoint.newBuilder()
            .host(canonicalHost)
            .encodedPath("/connect")
            .query(null)
            .fragment(null)
            .build()
    }
}
