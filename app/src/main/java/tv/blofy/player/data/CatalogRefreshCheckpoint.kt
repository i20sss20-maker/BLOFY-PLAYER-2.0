package tv.blofy.player.data

import android.content.Context
import tv.blofy.player.data.local.BlofyDao
import tv.blofy.player.data.local.ProviderEntity
import java.security.MessageDigest
import java.util.UUID

/**
 * Durable per-section checkpoint for a staged background Xtream refresh.
 *
 * Only fully parsed/validated sections qualify. The staging provider is never enabled, and
 * the visible catalog is not touched until a separate atomic promotion succeeds.
 * Secrets are fingerprinted and never saved to preferences.
 */
internal class CatalogRefreshCheckpoint(private val context: Context, private val providerId: String) {
    internal data class State(val stagedId: String, val completed: Set<String>)

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    suspend fun prepare(source: ProviderEntity, dao: BlofyDao): State {
        val expected = fingerprint(source)
        val savedId = prefs.getString(key("stage"), null).orEmpty()
        val ageMs = System.currentTimeMillis() - prefs.getLong(key("created"), 0L)
        val safeStage = savedId.startsWith(STAGING_PREFIX) && savedId != providerId
        val valid = safeStage && prefs.getString(key("source"), null) == expected &&
            ageMs >= 0L && ageMs < MAX_AGE_MS
        if (savedId.isNotBlank() && !valid) {
            // Never treat a corrupt preference containing a real provider ID as a disposable
            // candidate. Only app-owned, namespaced staging IDs may be deleted.
            if (safeStage) dao.discardStagedCatalog(savedId)
            erase(savedId)
        }

        val stageId = if (valid) savedId else STAGING_PREFIX + UUID.randomUUID().toString()
        if (!valid) {
            check(prefs.edit()
                .putString(key("stage"), stageId)
                .putString(key("source"), expected)
                .putLong(key("created"), System.currentTimeMillis())
                .commit()) { "Unable to save background catalog refresh checkpoint" }
        }

        val verified = linkedSetOf<String>()
        // A crash could leave rows from a partially streamed section. Clear only the
        // incomplete part while preserving the full sections written on previous runs.
        for (kind in SECTIONS) {
            val count = dao.catalogCountAll(stageId, kind)
            val recorded = prefs.getInt(key("count:$kind"), -1)
            val done = valid && prefs.getBoolean(key("done:$kind"), false) &&
                recorded >= 0 && recorded == count
            if (done) verified += kind
            else {
                dao.clearSearchIndex(stageId, kind)
                dao.clearStreams(stageId, kind)
                dao.clearCategories(stageId, kind)
                prefs.edit().remove(key("done:$kind")).remove(key("count:$kind")).apply()
            }
        }
        return State(stageId, verified)
    }

    suspend fun completed(state: State, kind: String, dao: BlofyDao) {
        require(kind in SECTIONS)
        // Only called after the streaming parser reaches the end and the DB writes complete.
        // An empty but legitimately completed section is allowed.
        if (prefs.getString(key("stage"), null) != state.stagedId) return
        val count = dao.catalogCountAll(state.stagedId, kind)
        check(prefs.edit()
            .putInt(key("count:$kind"), count)
            .putBoolean(key("done:$kind"), true)
            .commit()) { "Unable to checkpoint $kind refresh" }
    }

    suspend fun discard(state: State, dao: BlofyDao) {
        dao.discardStagedCatalog(state.stagedId)
        erase(state.stagedId)
    }

    fun finish(state: State) = erase(state.stagedId)

    private fun erase(stagedId: String) {
        if (prefs.getString(key("stage"), null) != stagedId) return
        val edit = prefs.edit().remove(key("stage")).remove(key("source")).remove(key("created"))
        SECTIONS.forEach { edit.remove(key("done:$it")).remove(key("count:$it")) }
        check(edit.commit()) { "Unable to remove completed background refresh checkpoint" }
    }

    private fun key(field: String) = "$providerId:$field"

    companion object {
        val SECTIONS = listOf("live", "movie", "series")
        private const val PREFS = "blofy_background_catalog_checkpoint_v1"
        private const val STAGING_PREFIX = "blofy-refresh-stage-"
        private const val MAX_AGE_MS = 48L * 60L * 60L * 1000L

        fun fingerprint(provider: ProviderEntity): String {
            val input = listOf(
                provider.providerType.lowercase(), provider.baseUrl.trim().trimEnd('/').lowercase(),
                provider.username, provider.password
            ).joinToString("|")
            return MessageDigest.getInstance("SHA-256")
                .digest(input.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }
    }
}
