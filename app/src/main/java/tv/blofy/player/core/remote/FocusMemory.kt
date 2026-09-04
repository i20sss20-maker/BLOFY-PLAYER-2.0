package tv.blofy.player.core.remote

import android.content.Context

/**
 * Compatibility shim for screens that still call FocusMemory.
 * Persistent last-position focus was intentionally removed: every screen now starts
 * from its normal first/default focus target instead of jumping to an old location.
 */
object FocusMemory {
    fun save(context: Context, screen: String, key: String) = Unit

    fun restore(context: Context, screen: String): String? = null

    fun clear(context: Context, screen: String) {
        context.applicationContext
            .getSharedPreferences("blofy_focus_memory", Context.MODE_PRIVATE)
            .edit()
            .remove(screen)
            .apply()
    }
}
