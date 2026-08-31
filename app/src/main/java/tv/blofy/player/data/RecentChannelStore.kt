package tv.blofy.player.data

import android.content.Context

object RecentChannelStore {
    private const val PREFS = "blofy_recent_channels"
    private const val MAX = 30

    fun record(context: Context, providerId: String, contentKey: String) {
        if (providerId.isBlank() || contentKey.isBlank()) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "recent:$providerId"
        val updated = buildList {
            add(contentKey)
            prefs.getString(key, null)
                ?.split('\n')
                ?.filter { it.isNotBlank() && it != contentKey }
                ?.let(::addAll)
        }.take(MAX)
        prefs.edit().putString(key, updated.joinToString("\n")).apply()
    }

    fun keys(context: Context, providerId: String): List<String> {
        if (providerId.isBlank()) return emptyList()
        return context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("recent:$providerId", null)
            ?.split('\n')
            ?.filter { it.isNotBlank() }
            .orEmpty()
    }

    fun clear(context: Context, providerId: String) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove("recent:$providerId").apply()
    }
}
