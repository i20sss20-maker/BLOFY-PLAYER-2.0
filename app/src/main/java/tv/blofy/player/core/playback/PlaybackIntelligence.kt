package tv.blofy.player.core.playback

import android.content.Context
import android.net.Uri

/** Learns successful live URL format per provider without changing the playback engine. */
object PlaybackIntelligence {
    private const val PREFS = "blofy_playback_intelligence"

    fun preferredUrl(context: Context, providerId: String, kind: String, originalUrl: String): String {
        if (kind != "live" && kind != "live_preview") return originalUrl
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return when (prefs.getString("$providerId.best_format", null)) {
            "hls" -> toHls(originalUrl) ?: originalUrl
            "ts" -> toTs(originalUrl) ?: originalUrl
            else -> originalUrl
        }
    }

    fun recordSuccess(context: Context, providerId: String, kind: String, url: String, startupMs: Long) {
        if (kind != "live" && kind != "live_preview") return
        val format = formatOf(url) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val successKey = "$providerId.$format.success"
        val latencyKey = "$providerId.$format.latency"
        val successes = prefs.getInt(successKey, 0) + 1
        val oldLatency = prefs.getLong(latencyKey, 0L)
        val avgLatency = if (oldLatency <= 0L) startupMs else ((oldLatency * (successes - 1)) + startupMs) / successes
        prefs.edit().putInt(successKey, successes).putLong(latencyKey, avgLatency).apply()
        chooseBest(context, providerId)
    }

    fun recordFailure(context: Context, providerId: String, kind: String, url: String) {
        if (kind != "live" && kind != "live_preview") return
        val format = formatOf(url) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "$providerId.$format.failure"
        prefs.edit().putInt(key, prefs.getInt(key, 0) + 1).apply()
        chooseBest(context, providerId)
    }

    private fun chooseBest(context: Context, providerId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun score(format: String): Double {
            val success = prefs.getInt("$providerId.$format.success", 0)
            val failure = prefs.getInt("$providerId.$format.failure", 0)
            val latency = prefs.getLong("$providerId.$format.latency", 0L)
            if (success == 0) return -failure.toDouble()
            val reliability = success * 4.0 - failure * 6.0
            val speedBonus = if (latency > 0) (10_000.0 / latency.coerceAtLeast(500L)).coerceAtMost(8.0) else 0.0
            return reliability + speedBonus
        }
        val hls = score("hls")
        val ts = score("ts")
        val best = when {
            hls <= 0.0 && ts <= 0.0 -> null
            hls >= ts -> "hls"
            else -> "ts"
        }
        prefs.edit().putString("$providerId.best_format", best).apply()
    }

    private fun formatOf(url: String): String? {
        val path = runCatching { Uri.parse(url).path.orEmpty().lowercase() }.getOrDefault(url.lowercase())
        return when {
            path.endsWith(".m3u8") -> "hls"
            path.endsWith(".ts") -> "ts"
            else -> null
        }
    }

    private fun toHls(url: String): String? = swapExtension(url, ".ts", ".m3u8")
    private fun toTs(url: String): String? = swapExtension(url, ".m3u8", ".ts")

    private fun swapExtension(url: String, from: String, to: String): String? {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return null
        val path = uri.path ?: return null
        if (!path.lowercase().endsWith(from)) return null
        val nextPath = path.dropLast(from.length) + to
        return uri.buildUpon().path(nextPath).build().toString()
    }
}
