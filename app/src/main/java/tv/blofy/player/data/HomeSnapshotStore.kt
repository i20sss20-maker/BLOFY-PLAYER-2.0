package tv.blofy.player.data

import android.content.Context
import com.google.gson.Gson
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity

/** Stable, provider-local Home selection. Stores keys only; media stays in Room/disk cache. */
object HomeSnapshotStore {
    private const val PREFS = "blofy_home_snapshot_v1"
    private const val MAX_CANDIDATES = 1200
    private val gson = Gson()

    data class Snapshot(
        val providerId: String,
        val builtAt: Long,
        val heroKeys: List<String>,
        val latestKeys: List<String>,
        val topRatedKeys: List<String>,
        val arabicKeys: List<String>,
        val ultraHdKeys: List<String>
    ) {
        val candidateKeys: List<String>
            get() = (heroKeys + latestKeys + topRatedKeys + arabicKeys + ultraHdKeys).distinct()
    }

    fun read(context: Context, providerId: String): Snapshot? {
        if (providerId.isBlank()) return null
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(providerId, null) ?: return null
        return runCatching { gson.fromJson(raw, Snapshot::class.java) }.getOrNull()?.takeIf { it.providerId == providerId }
    }

    suspend fun rebuild(context: Context, dao: BlofyDao, provider: ProviderEntity) {
        val all = dao.latestHomeStreams(provider.id, MAX_CANDIDATES)
        if (all.isEmpty()) return
        fun rating(stream: StreamEntity): Double = stream.rating?.replace(',', '.')?.toDoubleOrNull()?.let { if (it <= 5.0) it * 2.0 else it } ?: 0.0
        fun hasArabic(value: String) = value.any { it in '\u0600'..'\u06FF' }
        val snapshot = Snapshot(
            providerId = provider.id,
            builtAt = System.currentTimeMillis(),
            heroKeys = all.filter { !it.backdrop.isNullOrBlank() }.take(8).ifEmpty { all.take(8) }.map { it.key },
            latestKeys = all.take(80).map { it.key },
            topRatedKeys = all.asSequence().filter { rating(it) > 0.0 }.sortedByDescending(::rating).take(32).map { it.key }.toList(),
            arabicKeys = all.asSequence().filter { hasArabic(it.name) || hasArabic(it.genre.orEmpty()) || it.genre.orEmpty().contains("arab", true) }.take(28).map { it.key }.toList(),
            ultraHdKeys = all.asSequence().filter {
                val text = (it.name + " " + it.genre.orEmpty()).uppercase()
                text.contains("4K") || text.contains("UHD") || text.contains("HDR")
            }.take(28).map { it.key }.toList()
        )
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(provider.id, gson.toJson(snapshot)).apply()
    }

    fun clear(context: Context, providerId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(providerId).apply()
    }
}
