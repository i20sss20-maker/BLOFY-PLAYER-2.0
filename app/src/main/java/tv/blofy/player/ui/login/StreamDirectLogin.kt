package tv.blofy.player.ui.login

import android.content.Context
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import tv.blofy.player.core.identity.StreamCodeSession
import tv.blofy.player.core.url.PlaylistUrlPolicy
import tv.blofy.player.data.local.ProviderEntity
import java.util.UUID

/** Direct providers remain local and never redeem, replace or export BLOFY codes. */
object StreamDirectLogin {
    private const val PREFS = "blofy_stream_direct_entry"
    private const val KEY = "provider_id"
    private const val PREFIX = "stream-direct-"

    fun isDirectId(id: String?) = id?.startsWith(PREFIX) == true
    fun selected(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            ?.takeIf(::isDirectId)
    fun select(context: Context, id: String) {
        require(isDirectId(id))
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, id).commit())
    }
    fun clear(context: Context) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).commit())
    }

    data class Credentials(val host: String, val username: String, val password: String, val format: String = "ts") {
        fun provider(): ProviderEntity {
            val id = PREFIX + UUID.nameUUIDFromBytes(("xtream|" + host + "|" + username).toByteArray(Charsets.UTF_8))
            return ProviderEntity(id = id, name = "Xtream", baseUrl = host,
                username = username, password = password, liveFormat = format,
                preferredTransport = "http", allowCrossProtocolRedirects = false, enabled = false)
        }
        override fun toString() = "Credentials(redacted)"
    }

    fun xtream(host: String, username: String, password: String, format: String = "ts"): Credentials? {
        val raw = host.trim()
        if (!PlaylistUrlPolicy.isValid(raw) || username.isBlank() || password.isBlank()) return null
        val url = raw.toHttpUrlOrNull() ?: return null
        if (url.host.equals("blofyplayer.com", true) || url.query != null || url.fragment != null) return null
        val base = url.toString().trimEnd('/')
        return Credentials(base, username.trim(), password, if (format == "m3u8") "m3u8" else "ts")
    }

    /** Xtream-exported M3U links are imported via the same authenticated catalog.
     * Arbitrary standalone M3U files are not silently treated as Xtream. */
    fun m3u(link: String): Credentials? {
        val raw = link.trim()
        if (!PlaylistUrlPolicy.isValid(raw)) return null
        val url = raw.toHttpUrlOrNull() ?: return null
        if (!url.encodedPath.endsWith("/get.php", true) || url.fragment != null) return null
        if (url.queryParameterValues("username").size != 1 ||
            url.queryParameterValues("password").size != 1) return null
        val host = url.newBuilder().removePathSegment(url.pathSegments.lastIndex).query(null).fragment(null).build()
        return xtream(host.toString(), url.queryParameter("username").orEmpty(),
            url.queryParameter("password").orEmpty(), url.queryParameter("output").orEmpty())
    }
}
