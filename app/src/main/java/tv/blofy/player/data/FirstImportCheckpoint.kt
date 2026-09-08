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
     * Revalidate checkpointed work against durable Room rows before trusting it. A checkpoint is a
     * resume optimisation, never an authority over the database. If rows disappeared after a crash,
     * storage cleanup or an interrupted transaction, that section is downgraded and downloaded again.
     *
     * An empty Xtream section can legitimately complete, but if the process dies before the final
     * catalog commit we deliberately fetch that empty section again. This conservative choice avoids
     * mistaking lost rows for a valid empty section and only affects interrupted first imports.
     */
    suspend fun discardIncompleteSections(
        context: Context,
        dao: BlofyDao,
        provider: ProviderEntity,
    ): State {
        val stored = state(context, provider)
        val verified = linkedSetOf<String>()
        for (kind in sections) {
            if (stored.isCompleted(kind) && dao.catalogCountAll(provider.id, kind) > 0) {
                verified += kind
            } else {
                clearSection(dao, provider.id, kind)
                if (stored.isCompleted(kind)) clearCompletedFlag(context, provider.id, kind)
            }
        }
        return stored.copy(completed = verified)
    }

    private suspend fun clearSection(dao: BlofyDao, providerId: String, kind: String) {
        dao.clearSearchIndex(providerId, kind)
        dao.clearStreams(providerId, kind)
        dao.clearCategories(providerId, kind)
        if (kind == "series") dao.clearProviderEpisodes(providerId)
    }

    private fun clearCompletedFlag(context: Context, providerId: String, kind: String) {
        check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(doneKey(providerId, kind)).commit()) { "Unable to invalidate first-import checkpoint" }
    }

    private fun doneKey(providerId: String, kind: String) = "$DONE_PREFIX$providerId:$kind"

    private fun fingerprint(provider: ProviderEntity): String {
        // Password participates in the digest so reused usernames on the same panel never inherit
        // another account's partial import. Only the SHA-256 fingerprint is persisted.
        val value = buildString {
            append(provider.providerType.lowercase())
            append('|')
            append(provider.baseUrl.trim().trimEnd('/').lowercase())
            append('|')
            append(provider.username)
            append('|')
            append(provider.password)
        }
        return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
