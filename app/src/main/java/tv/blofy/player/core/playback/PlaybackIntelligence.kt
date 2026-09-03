package tv.blofy.player.core.playback

import android.content.Context
import android.net.Uri

/** Learns successful live URL format per provider without changing the playback engine. */
object PlaybackIntelligence {
    private const val PREFS = "blofy_playback_intelligence"

    data class FormatStats(
        val successes: Int,
        val failures: Int,
        val averageStartupMs: Long,
        val lastSuccessAt: Long,
        val lastFailureAt: Long
    ) {
        val attempts: Int get() = successes + failures
        val reliabilityPercent: Int
            get() = if (attempts <= 0) 0 else ((successes * 100L) / attempts).toInt()
    }

    data class Snapshot(
        val preferredFormat: String?,
        val hls: FormatStats,
        val ts: FormatStats,
        val lastUpdatedAt: Long
    ) {
        val totalAttempts: Int get() = hls.attempts + ts.attempts
        val hasLearning: Boolean get() = totalAttempts > 0
    }

    fun preferredUrl(
        context: Context,
        providerId: String,
        kind: String,
        originalUrl: String
    ): String {
        if (kind != "live" && kind != "live_preview") return originalUrl
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return when (prefs.getString("$providerId.best_format", null)) {
            "hls" -> toHls(originalUrl) ?: originalUrl
            "ts" -> toTs(originalUrl) ?: originalUrl
            else -> originalUrl
        }
    }

    fun recordSuccess(
        context: Context,
        providerId: String,
        kind: String,
        url: String,
        startupMs: Long
    ) {
        if (kind != "live" && kind != "live_preview") return
        val format = formatOf(url) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val successKey = "$providerId.$format.success"
        val latencyKey = "$providerId.$format.latency"
        val successes = prefs.getInt(successKey, 0) + 1
        val oldLatency = prefs.getLong(latencyKey, 0L)
        val boundedStartup = startupMs.coerceAtLeast(0L)
        val avgLatency = if (oldLatency <= 0L) {
            boundedStartup
        } else {
            ((oldLatency * (successes - 1)) + boundedStartup) / successes
        }
        val now = System.currentTimeMillis()
        prefs.edit()
            .putInt(successKey, successes)
            .putLong(latencyKey, avgLatency)
            .putLong("$providerId.$format.last_success", now)
            .putLong("$providerId.last_updated", now)
            .apply()
        chooseBest(context, providerId)
    }

    fun recordFailure(
        context: Context,
        providerId: String,
        kind: String,
        url: String
    ) {
        if (kind != "live" && kind != "live_preview") return
        val format = formatOf(url) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "$providerId.$format.failure"
        val now = System.currentTimeMillis()
        prefs.edit()
            .putInt(key, prefs.getInt(key, 0) + 1)
            .putLong("$providerId.$format.last_failure", now)
            .putLong("$providerId.last_updated", now)
            .apply()
        chooseBest(context, providerId)
    }

    fun snapshot(context: Context, providerId: String): Snapshot {
        if (providerId.isBlank()) {
            return Snapshot(
                preferredFormat = null,
                hls = FormatStats(0, 0, 0L, 0L, 0L),
                ts = FormatStats(0, 0, 0L, 0L, 0L),
                lastUpdatedAt = 0L
            )
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun stats(format: String) = FormatStats(
            successes = prefs.getInt("$providerId.$format.success", 0),
            failures = prefs.getInt("$providerId.$format.failure", 0),
            averageStartupMs = prefs.getLong("$providerId.$format.latency", 0L),
            lastSuccessAt = prefs.getLong("$providerId.$format.last_success", 0L),
            lastFailureAt = prefs.getLong("$providerId.$format.last_failure", 0L)
        )
        return Snapshot(
            preferredFormat = prefs.getString("$providerId.best_format", null),
            hls = stats("hls"),
            ts = stats("ts"),
            lastUpdatedAt = prefs.getLong("$providerId.last_updated", 0L)
        )
    }

    fun clear(context: Context, providerId: String) {
        if (providerId.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prefix = "$providerId."
        val keys = prefs.all.keys.filter { it.startsWith(prefix) }
        val editor = prefs.edit()
        keys.forEach(editor::remove)
        editor.apply()
    }

    private fun chooseBest(context: Context, providerId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun score(format: String): Double {
            val success = prefs.getInt("$providerId.$format.success", 0)
            val failure = prefs.getInt("$providerId.$format.failure", 0)
            val latency = prefs.getLong("$providerId.$format.latency", 0L)
            if (success == 0) return -failure.toDouble()
            val reliability = success * 4.0 - failure * 6.0
            val speedBonus = if (latency > 0) {
                (10_000.0 / latency.coerceAtLeast(500L)).coerceAtMost(8.0)
            } else {
                0.0
            }
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
        val path = runCatching {
            Uri.parse(url).path.orEmpty().lowercase()
        }.getOrDefault(url.lowercase())
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
