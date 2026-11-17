package tv.blofy.player.core.remote

import android.content.Context
import java.util.LinkedHashMap

/**
 * Only episode/season selection is restored across adjacent screens. Old global
 * Home focus checkpoints are deliberately ignored: restoring a stale Home
 * focus caused D-pad to jump to Search after returning from playback.
 *
 * Memory is process-local and short-lived; never persist programme names,
 * provider credentials, or viewing history in this focus helper.
 */
object FocusMemory {
    private val episodeCheckpoints = FocusCheckpointStore()

    fun save(context: Context, screen: String, key: String) {
        if (screen.startsWith("episodes:")) episodeCheckpoints.save(screen, key)
    }

    fun restore(context: Context, screen: String): String? =
        if (screen.startsWith("episodes:")) episodeCheckpoints.restore(screen) else null

    fun clear(context: Context, screen: String) {
        episodeCheckpoints.clear(screen)
        context.applicationContext
            .getSharedPreferences("blofy_focus_memory", Context.MODE_PRIVATE)
            .edit().remove(screen).apply()
    }
}

/** Bounds how far a saved focus can live and refuses stale/stolen selection. */
internal class FocusCheckpointStore(
    private val now: () -> Long = System::currentTimeMillis,
    private val maxItems: Int = 100,
    private val maxAgeMillis: Long = 30L * 60L * 1000L,
) {
    private data class Entry(val key: String, val savedAt: Long)
    private val recent = LinkedHashMap<String, Entry>(16, 0.75f, true)

    @Synchronized
    fun save(screen: String, key: String) {
        if (screen.isBlank() || key.isBlank() || key.length > 256 || screen.length > 256) return
        val time = now()
        recent[screen] = Entry(key, time)
        while (recent.size > maxItems) recent.remove(recent.keys.first())
    }

    @Synchronized
    fun restore(screen: String): String? {
        val saved = recent[screen] ?: return null
        val age = now() - saved.savedAt
        if (age < 0 || age > maxAgeMillis) {
            recent.remove(screen)
            return null
        }
        return saved.key
    }

    @Synchronized
    fun clear(screen: String) {
        recent.remove(screen)
    }
}
