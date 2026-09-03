package tv.blofy.player.core.remote

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap

object FocusMemory {
    private const val PREFS = "blofy_focus_memory"
    private const val SAVE_DELAY_MS = 350L
    private val memory = ConcurrentHashMap<String, String>()
    private val handler = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<String, Runnable>()

    fun save(context: Context, screen: String, key: String) {
        if (screen.isBlank() || key.isBlank()) return
        if (memory.put(screen, key) == key) return

        pending.remove(screen)?.let(handler::removeCallbacks)
        val app = context.applicationContext
        val task = Runnable {
            pending.remove(screen)
            val latest = memory[screen] ?: return@Runnable
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(screen, latest)
                .apply()
        }
        pending[screen] = task
        handler.postDelayed(task, SAVE_DELAY_MS)
    }

    fun restore(context: Context, screen: String): String? {
        memory[screen]?.let { return it }
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(screen, null)
            ?.also { memory[screen] = it }
    }

    fun clear(context: Context, screen: String) {
        memory.remove(screen)
        pending.remove(screen)?.let(handler::removeCallbacks)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(screen).apply()
    }
}
