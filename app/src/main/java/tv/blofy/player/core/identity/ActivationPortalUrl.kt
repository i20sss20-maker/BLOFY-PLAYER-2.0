package tv.blofy.player.core.identity

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Builds the public activation-portal URL encoded by the login-screen QR code. */
object ActivationPortalUrl {
    fun create(baseUrl: String, deviceId: String, activationCode: String): String? {
        val normalizedDeviceId = deviceId.trim()
        val normalizedCode = activationCode.trim()
        if (normalizedDeviceId.isBlank() || !normalizedCode.matches(Regex("[0-9]{6}"))) return null

        val activationEndpoint = baseUrl.trim().toHttpUrlOrNull() ?: return null
        if (!activationEndpoint.isHttps) return null

        // The activation API serves the actual device pairing form at /portal.
        // Its root can instead show the landing page, and /connect is not a
        // registered API route. Use the same verified pairing URL for Play and APK.
        val portal = activationEndpoint.resolve("/portal") ?: return null
        val activationFragment = buildString {
            append("deviceId=")
            append(normalizedDeviceId)
            append("&code=")
            append(normalizedCode)
        }
        return portal.newBuilder()
            // A fragment is client-side only and is not included in portal HTTP requests or access logs.
            .fragment(activationFragment)
            .build()
            .toString()
    }
}
