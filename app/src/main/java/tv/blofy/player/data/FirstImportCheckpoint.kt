package tv.blofy.player.data

import android.content.Context
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import java.security.MessageDigest

/**
 * Durable checkpoints for the very first Xtream import.
 *
 * A section is marked only after PlaylistManager completed and validated it. In-progress rows are
 * never exposed as a ready catalog. If the Activity/process disappears later, completed sections
 * stay in Room and only the unfinished section is downloaded again.
 */
object FirstImportCheckpoint {
    private const val PREFS = "blofy_first_import_checkpoint_v1"
    private const val SOURCE_PREFIX = "source:"
    private const val DONE_PREFIX = "done:"
    val sections = listOf("live", "movie", "series")

    data class State internal constructor(
        val providerId: String,
        val sourceFingerprint: String,
        val completed: Set<String>,
    ) {
        fun isCompleted(kind: String): Boolean = kind in completed
    }

    fun state(context: Context, provider: ProviderEntity): State {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val expected = fingerprint(provider)
        val stored = prefs.getString(SOURCE_PREFIX + provider.id, null)
        if (stored != expected) {
            val editor = prefs.edit().putString(SOURCE_PREFIX + provider.id, expected)
            sections.forEach { editor.remove(doneKey(provider.id, it)) }
            check(editor.commit()) { "Unable to reset first-import checkpoint" }
            return State(provider.id, expected, emptySet())
        }
        val completed = sections.filterTo(linkedSetOf()) { prefs.getBoolean(doneKey(provider.id, it), false) }
        return State(provider.id, expected, completed)
    }

    fun markCompleted(context: Context, provider: ProviderEntity, kind: String) {
        require(kind in sections) { "Unsupported catalog section: $kind" }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val expected = fingerprint(provider)
        val editor = prefs.edit()
        if (prefs.getString(SOURCE_PREFIX + provider.id, null) != expected) {
            editor.putString(SOURCE_PREFIX + provider.id, expected)
            sections.forEach { editor.remove(doneKey(provider.id, it)) }
        }
        check(editor.putBoolean(doneKey(provider.id, kind), true).commit()) {
            "Unable to persist first-import checkpoint"
        }
    }

    fun clear(context: Context, providerId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit().remove(SOURCE_PREFIX + providerId)
        sections.forEach { editor.remove(doneKey(providerId, it)) }
        editor.apply()
    }

    /**
     * Remove only sections that were never committed to the checkpoint. A legacy interrupted
     * import has rows but no checkpoint, so all three sections are cleared once and starts clean.
     */
    suspend fun discardIncompleteSections(
        context: Context,
        dao: BlofyDao,
        provider: ProviderEntity,
    ): State {
        val checkpoint = state(context, provider)
        sections.filterNot(checkpoint::isCompleted).forEach { kind ->
            dao.clearSearchIndex(provider.id, kind)
            dao.clearStreams(provider.id, kind)
            dao.clearCategories(provider.id, kind)
            if (kind == "series") dao.clearProviderEpisodes(provider.id)
        }
        return checkpoint
    }

    private fun doneKey(providerId: String, kind: String) = "$DONE_PREFIX$providerId:$kind"

    private fun fingerprint(provider: ProviderEntity): String {
        val value = buildString {
            append(provider.providerType.lowercase())
            append('|')
            append(provider.baseUrl.trim().trimEnd('/').lowercase())
            append('|')
            append(provider.username)
        }
        return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
