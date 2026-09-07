package tv.blofy.player.core.identity

import android.content.Context
import tv.blofy.player.data.local.ProviderEntity
import java.util.UUID

/** Keeps remote identity/confirmed aliases and pending deletes without rewriting cached content keys. */
object PortalSyncBook {
    private const val PREFS = "blofy_portal_reconciliation_v1"
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun hidden(context: Context) = prefs(context).getStringSet("hidden", emptySet()).orEmpty().toSet()
    fun visible(context: Context, items: List<ProviderEntity>): List<ProviderEntity> {
        val hidden = hidden(context)
        return items.filterNot { it.id in hidden }
    }
    fun remoteId(context: Context, localId: String): String = prefs(context).getString("remote:$localId", null) ?: localId
    fun isKnown(context: Context, localId: String): Boolean = prefs(context).contains("remote:$localId")
    fun pending(context: Context): Set<String> = prefs(context).getStringSet("pending_deletes", emptySet()).orEmpty().toSet()
    fun pendingSourceId(localId: String): String = UUID.nameUUIDFromBytes("BLOFY-PORTAL-SOURCE|$localId".toByteArray(Charsets.UTF_8)).toString()
    fun hasPendingSource(context: Context, localId: String): Boolean = prefs(context).getBoolean("source_pending:$localId", false)
    @Synchronized
    fun markPendingSource(context: Context, localId: String) {
        check(prefs(context).edit().putBoolean("source_pending:$localId", true)
            .putStringSet("hidden", hidden(context) + pendingSourceId(localId)).commit())
    }
    @Synchronized
    fun clearPendingSource(context: Context, localId: String) {
        check(prefs(context).edit().remove("source_pending:$localId").commit())
    }
    @Synchronized
    fun bind(context: Context, localId: String, remoteId: String, aliases: Set<String> = emptySet()) {
        val editor = prefs(context).edit().putString("remote:$localId", remoteId)
            .putStringSet("hidden", (hidden(context) + aliases) - localId)
        aliases.forEach { editor.putString("remote:$it", remoteId) }
        check(editor.commit()) { "Unable to persist playlist identity" }
    }
    @Synchronized
    fun hide(context: Context, ids: Set<String>) {
        check(prefs(context).edit().putStringSet("hidden", hidden(context) + ids).commit())
    }
    @Synchronized
    fun queueDelete(context: Context, remoteId: String, localIds: Set<String>) {
        check(prefs(context).edit().putStringSet("hidden", hidden(context) + localIds)
            .putStringSet("pending_deletes", pending(context) + remoteId).commit())
    }
    @Synchronized
    fun acknowledgeDelete(context: Context, remoteId: String) {
        check(prefs(context).edit().putStringSet("pending_deletes", pending(context) - remoteId).commit())
    }
}
